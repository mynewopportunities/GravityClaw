/**
 * bot.ts — Telegram bot with security-first design
 */

import { Bot, InputFile } from "grammy";
import { TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, LLM_MODEL } from "./config.js";
import { runAgent, clearHistory } from "./agent.js";
import { transcribeAudio } from "./transcribe.js";
import { getUsageSummary } from "./usage.js";
import { countMessages, pruneHistory } from "./memory.js";
import { textToSpeech, isTTSAvailable } from "./tts.js";
import { db } from "./db.js";

const BOT_START_TIME = Date.now();

// ── Persistent Voice Mode Helper ─────────────────────────
function isVoiceMode(chatId: string | number): boolean {
    const cid = String(chatId);
    try {
        const row = db.prepare("SELECT value FROM user_settings WHERE chat_id = ? AND key = 'voice_enabled'").get(cid) as any;
        return row?.value === "true";
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

export const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ── Middleware ──────────────────────────────────────────
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId || !ALLOWED_USER_IDS.includes(userId)) return;
    await next();
});

// ── Commands ────────────────────────────────────────────
bot.command("start", async (ctx) => {
    await ctx.reply(
        `🪐 **Gravity Claw** is online.\n\n` +
        `I have been upgraded with **Persistent Settings**. Your preferences now survive server restarts!\n\n` +
        `**Commands:**\n` +
        `  /voice — Toggle Jacqueline voice mode 🎤\n` +
        `  /status — System health & uptime\n` +
        `  /new — Clear conversation and start fresh\n` +
        `  /usage — Token & cost statistics\n\n` +
        `_Currently integrated with: Telegram, WhatsApp (Beta), MCP Bridge_`,
        { parse_mode: "Markdown" }
    );
});

bot.command("voice", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isTTSAvailable()) {
        await ctx.reply("❌ Cartesia API key not set.");
        return;
    }
    const current = isVoiceMode(chatId);
    setVoiceMode(chatId, !current);
    if (!current) {
        await ctx.reply(
            `🎙️ **Voice Mode ON** — I will now speak all responses.\n\n` +
            `This setting is now saved permanently to my database.`,
            { parse_mode: "Markdown" }
        );
    } else {
        await ctx.reply("💬 **Voice Mode OFF** — back to text responses.", { parse_mode: "Markdown" });
    }
});

bot.command("status", async (ctx) => {
    const uptimeMs = Date.now() - BOT_START_TIME;
    const hours = Math.floor(uptimeMs / 3_600_000);
    const mins = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const secs = Math.floor((uptimeMs % 60_000) / 1000);
    const msgCount = countMessages(ctx.chat.id);
    const voice = isVoiceMode(ctx.chat.id) ? "ON" : "OFF";

    await ctx.reply(
        `🪐 **Status**\n` +
        `• Uptime: ${hours}h ${mins}m ${secs}s\n` +
        `• Context: ${msgCount} msgs\n` +
        `• Voice Mode: ${voice}`,
        { parse_mode: "Markdown" }
    );
});

bot.command("usage", async (ctx) => {
    await ctx.reply(getUsageSummary(ctx.chat.id), { parse_mode: "Markdown" });
});

bot.command("new", async (ctx) => {
    clearHistory(ctx.chat.id);
    await ctx.reply("🧹 History cleared.");
});

// ── Unified Response Sender ─────────────────────────────
async function sendResponse(ctx: any, chatId: string | number, response: string, forceVoice: boolean = false): Promise<void> {
    const voiceActive = forceVoice || isVoiceMode(chatId);

    if (voiceActive && isTTSAvailable()) {
        try {
            await ctx.replyWithChatAction("record_voice");
            const audioBuffer = await textToSpeech(response);
            await ctx.replyWithVoice(new InputFile(audioBuffer, "response.mp3"));
            return;
        } catch (ttsErr) {
            console.error("❌ TTS error:", ttsErr);
        }
    }

    // Fallback to text
    if (response.length <= 4096) {
        await ctx.reply(response, { parse_mode: "Markdown" }).catch(() => ctx.reply(response));
    } else {
        const chunks = response.match(/[\s\S]{1,4000}/g) || [response];
        for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
        }
    }
}

// ── Handlers ────────────────────────────────────────────
bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    try {
        await ctx.replyWithChatAction("typing");
        const file = await ctx.getFile();
        const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        const transcription = await transcribeAudio(fileUrl);

        await ctx.reply(`🎤 **Transcribed:** _"${transcription}"_`, {
            parse_mode: "Markdown",
            reply_to_message_id: ctx.message.message_id
        });

        const response = await runAgent(chatId, transcription);

        // If they send voice, we respond with voice (regardless of global setting)
        await sendResponse(ctx, chatId, response, true);
    } catch (error) {
        console.error("❌ Voice handle error:", error);
        await ctx.reply("⚠️ Trouble processing voice message.");
    }
});

bot.on("message:text", async (ctx) => {
    try {
        await ctx.replyWithChatAction("typing");
        const response = await runAgent(ctx.chat.id, ctx.message.text);
        await sendResponse(ctx, ctx.chat.id, response);
    } catch (error) {
        console.error("❌ Agent error:", error);
        await ctx.reply("⚠️ Agent error.");
    }
});

bot.catch((err) => console.error("❌ Bot error:", err.error));
