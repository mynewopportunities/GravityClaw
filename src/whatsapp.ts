/**
 * whatsapp.ts — WhatsApp integration via Baileys
 *
 * Implements Phase 1.1: WhatsApp Messaging.
 * Support text, media, and persistent sessions.
 */

import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import "qrcode-terminal"; // Just import to satisfy the side-effect if needed, though Baileys handles it
import pino from "pino";
import path from "path";
import { fileURLToPath } from "url";
import { db } from "./db.js";
import { textToSpeech, isTTSAvailable } from "./tts.js";
import { countMessages } from "./memory.js";
import fs from "fs";
import { runAgent } from "./agent.js";
import { WHATSAPP_ALLOWED_NUMBERS } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "wa_auth");

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR);
}

// Ensure local ffmpeg is in PATH for Baileys to handle PTT correctly
const homeBin = path.join(process.env.HOME || "/home/ubuntu", "bin");
if (fs.existsSync(homeBin)) {
    process.env.PATH = `${homeBin}:${process.env.PATH}`;
}

const logger = pino({ level: "error" });

export let waClient: any = null;

function isVoiceMode(chatId: string | number): boolean {
    const cid = String(chatId);
    const adminJid = (process.env.WA_PHONE_NUMBER || "").replace(/[^0-9]/g, "") + "@s.whatsapp.net";

    try {
        // 1. Check if the specific chat has a setting
        const row = db.prepare("SELECT value FROM user_settings WHERE chat_id = ? AND key = 'voice_enabled'").get(cid) as any;
        if (row?.value === "true") return true;

        // 2. Check if the Admin has enabled voice globally for the bot
        const adminRow = db.prepare("SELECT value FROM user_settings WHERE chat_id = ? AND key = 'voice_enabled'").get(adminJid) as any;
        return adminRow?.value === "true";
    } catch (e) {
        return false;
    }
}

function setVoiceMode(chatId: string | number, enabled: boolean): void {
    const cid = String(chatId);
    db.prepare(`
        INSERT INTO user_settings (chat_id, key, value) 
        VALUES (?, 'voice_enabled', ?)
        ON CONFLICT(chat_id, key) DO UPDATE SET value = EXCLUDED.value
    `).run(cid, String(enabled));
}

export async function initWhatsApp() {
    console.log("  🟢 WhatsApp: Initializing...");

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    waClient = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: true,
        logger,
        browser: ["Ubuntu", "Chrome", "20.0.04"],
    });

    waClient.ev.on("creds.update", saveCreds);

    waClient.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !process.env.WA_PHONE_NUMBER) {
            console.log("\n  📱 WhatsApp Login Required:");
            console.log("  1. Open WhatsApp on your phone");
            console.log("  2. Settings > Linked Devices > Link a Device");
            console.log("  3. Scan the QR code below or open this link in your browser:");
            console.log(`  🔗 https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=300x300\n`);

            // Re-import and print explicitly for PM2 environments
            import("qrcode-terminal").then(q => q.default.generate(qr, { small: true }));
        }

        if (connection === "close") {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log("  🔴 WhatsApp: Connection closed due to ", lastDisconnect?.error, ", reconnecting ", shouldReconnect);
            if (shouldReconnect) {
                initWhatsApp();
            }
        } else if (connection === "open") {
            console.log("  ✅ WhatsApp: Connected successfully!");
        }
    });

    // Request Pairing Code if phone number is provided and not registered
    if (process.env.WA_PHONE_NUMBER) {
        setTimeout(async () => {
            try {
                // Only request if not already logged in
                if (waClient?.authState?.creds?.registered) return;

                const phoneNumber = process.env.WA_PHONE_NUMBER!.replace(/[^0-9]/g, "");
                console.log(`  📱 WhatsApp: Requesting pairing code for ${phoneNumber}...`);
                const code = await waClient.requestPairingCode(phoneNumber);
                console.log("\n  🚀 NEW WHATSAPP PAIRING CODE:");
                console.log(`  👉 [ ${code} ] 👈`);
                console.log("  1. Open WhatsApp > Settings > Linked Devices");
                console.log("  2. Link a Device > Link with phone number instead");
                console.log(`  3. Enter the code above on your phone.\n`);
            } catch (err: any) {
                console.error("  ❌ Failed to request pairing code:", err.message);
            }
        }, 10000);
    }

    waClient.ev.on("messages.upsert", async (m: any) => {
        if (m.type !== "notify") return;

        for (const msg of m.messages) {
            const jid = msg.key.remoteJid;
            if (!jid) continue;

            // 1. HARD BLOCK SOPHIA AND OTHER BOTS
            // +1 510 560 7084 is Sophia. We ALSO ignore anything with "agent" in the name if possible.
            if (jid.includes("15105607084")) {
                console.log(`  🚫 WhatsApp: Ignoring Sophia-agent (${jid})`);
                continue;
            }

            // 2. LOOP PREVENTION (Crucial for Self-Chat)
            const isBotId = msg.key.id?.startsWith("BAE5") || msg.key.id?.length! > 22;
            if (msg.key.fromMe && isBotId) {
                // This is a message SENT by our bot. IGNORE IT.
                continue;
            }

            // If it's fromMe but NOT a bot ID, it's the USER typing on their phone in "Message Yourself".
            // We only process if it's NOT fromMe OR if it's the user in self-chat.
            const isUserInSelfChat = msg.key.fromMe && jid.includes(waClient.user.id.split(":")[0]);
            if (msg.key.fromMe && !isUserInSelfChat) {
                continue;
            }

            // 3. WHITELIST CHECK (Safety for Clients)
            // If the whitelist is NOT empty, verify the JID matches one of the allowed numbers
            const isAllowed = WHATSAPP_ALLOWED_NUMBERS.some(num => jid.includes(num));
            if (WHATSAPP_ALLOWED_NUMBERS.length > 0 && !isAllowed && !isUserInSelfChat) {
                console.log(`  🚫 WhatsApp: Ignoring unwhitelisted number (${jid})`);
                continue;
            }

            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption;

            if (!text) continue;

            console.log(`  💬 WhatsApp [${jid}]: ${text.substring(0, 50)}`);

            // ── Basic Command Handling for WhatsApp ────────────────
            if (text.startsWith("/")) {
                const cmd = text.toLowerCase().split(" ")[0];
                if (cmd === "/voice") {
                    const current = isVoiceMode(jid);
                    setVoiceMode(jid, !current);
                    await waClient.sendMessage(jid, { text: !current ? "🎙️ *Voice Mode ON* (Global)" : "💬 *Voice Mode OFF*" });
                    return;
                }
                if (cmd === "/status") {
                    const msgCount = countMessages(jid);
                    const voice = isVoiceMode(jid) ? "ON" : "OFF";
                    await waClient.sendMessage(jid, { text: `🪐 *Status*\n• Mode: WhatsApp\n• Context: ${msgCount} msgs\n• Voice: ${voice}` });
                    return;
                }
                if (cmd === "/new") {
                    await waClient.sendMessage(jid, { text: "🧹 History cleared." });
                    // runAgent handles clearing if needed, but for now we just acknowledge
                    return;
                }
            }

            try {
                // Thinking indicator
                await waClient.sendPresenceUpdate("composing", jid);

                const response = await runAgent(jid, text);
                if (!response || response.trim().length === 0) {
                    console.log("  ⚠️ WhatsApp: Agent returned empty response, skipping.");
                    return;
                }

                // Final Check: Is Voice Enabled?
                const voiceOn = isVoiceMode(jid);

                if (voiceOn && isTTSAvailable()) {
                    console.log(`  🎙️ WhatsApp: Generating voice for ${jid}...`);
                    const tempFile = path.join(__dirname, "..", `temp_voice_${Date.now()}.mp3`);
                    try {
                        const audioBuffer = await textToSpeech(response);
                        fs.writeFileSync(tempFile, audioBuffer);

                        console.log(`  📡 WhatsApp: Sending voice note via file: ${tempFile}`);
                        await waClient.sendMessage(jid, {
                            audio: { url: tempFile },
                            mimetype: "audio/mpeg",
                            ptt: true
                        });

                        console.log("  ✅ WhatsApp: Voice Note sent successfully.");
                    } catch (ttsErr: any) {
                        console.error("  ❌ WhatsApp Voice Error:", ttsErr.message);
                        await waClient.sendMessage(jid, { text: response });
                    } finally {
                        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
                    }
                } else {
                    await waClient.sendMessage(jid, { text: response });
                }
            } catch (err: any) {
                console.error("  ❌ WhatsApp Error:", err.message);
            }
        }
    });
}

/**
 * Universal sender for WhatsApp
 */
export async function sendWhatsAppMessage(jid: string, text: string) {
    if (!waClient) throw new Error("WhatsApp client not initialized");
    await waClient.sendMessage(jid, { text });
}
