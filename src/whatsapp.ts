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
import fs from "fs";
import { runAgent } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUTH_DIR = path.join(__dirname, "..", "wa_auth");

if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR);
}

const logger = pino({ level: "error" });

export let waClient: any = null;

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
        browser: ["Gravity Claw", "Chrome", "1.0.0"],
    });

    waClient.ev.on("creds.update", saveCreds);

    waClient.ev.on("connection.update", (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("  📱 WhatsApp: Scan the QR code below to login:");
            // QR is already printed by printQRInTerminal: true
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

    waClient.ev.on("messages.upsert", async (m: any) => {
        if (m.type !== "notify") return;

        for (const msg of m.messages) {
            if (msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const text = msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption;

            if (!text || !jid) continue;

            console.log(`  💬 WhatsApp [${jid}]: ${text.substring(0, 50)}`);

            try {
                // Show typing indicator
                await waClient.presenceSubscribe(jid);
                await waClient.sendPresenceUpdate("composing", jid);

                const response = await runAgent(jid, text);

                // Stop typing and send
                await waClient.sendPresenceUpdate("paused", jid);
                await waClient.sendMessage(jid, { text: response });
            } catch (err: any) {
                console.error("  ❌ WhatsApp Error:", err.message);
                await waClient.sendMessage(jid, { text: "⚠️ Sorry, I encountered an error processing that." });
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
