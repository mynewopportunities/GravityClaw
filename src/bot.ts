/**
 * bot.ts — Telegram bot with security-first design
 *
 * Security model:
 *   1. User ID whitelist — only responds to ALLOWED_USER_IDS
 *   2. Long-polling only — no web server, no exposed ports, no HTTP
 *   3. Graceful error handling — never leaks internals to Telegram
 */

import { Bot, InputFile } from "grammy";
import { TELEGRAM_BOT_TOKEN, ALLOWED_USER_IDS, LLM_MODEL } from "./config.js";
import { runAgent, clearHistory } from "./agent.js";
import { transcribeAudio } from "./transcribe.js";
import { getUsageSummary } from "./usage.js";
import { countMessages, pruneHistory } from "./memory.js";
import { textToSpeech, isTTSAvailable } from "./tts.js";

// ── Bot started time (for /status) ──────────────────────
const BOT_START_TIME = Date.now();

// ── Per-user voice mode toggle (true = reply with audio) ─
const voiceModeEnabled: Map<number, boolean> = new Map();
function isVoiceMode(chatId: number): boolean {
    return voiceModeEnabled.get(chatId) ?? false;
}

// ── Create Bot (long-polling, NO webhooks) ──────────────
export const bot = new Bot(TELEGRAM_BOT_TOKEN);

// ── Security Middleware — runs before EVERY handler ─────
bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;

    // Silently ignore messages from unauthorized users
    if (!userId || !ALLOWED_USER_IDS.includes(userId)) {
        return;
    }

    await next();
});

// ── /start command ──────────────────────────────────────
bot.command("start", async (ctx) => {
    await ctx.reply(
        `🪐 **Gravity Claw** is online.\n\n` +
        `I'm your personal AI assistant with voice, web search, and file access.\n\n` +
        `**Commands:**\n` +
        `  /voice — Toggle Alexandra voice mode 🎤\n` +
        `  /status — System health & uptime\n` +
        `  /new — Clear conversation and start fresh\n` +
        `  /compact — Summarize & compress context\n` +
        `  /usage — Token & cost statistics\n` +
        `  /model — Show current AI model\n` +
        `  /help — Full command list\n\n` +
        `_Phase 3 — Voice: ElevenLabs TTS (Alexandra)_`,
        { parse_mode: "Markdown" }
    );
});

// ── /help command ───────────────────────────────────────
bot.command("help", async (ctx) => {
    await ctx.reply(
        `🪐 **Gravity Claw** — Commands\n\n` +
        `*🎤 Voice:*\n` +
        `  /voice — Toggle Alexandra voice mode on/off\n\n` +
        `*🧠 Core:*\n` +
        `  /status — System health, uptime, memory stats\n` +
        `  /new — Clear conversation history\n` +
        `  /compact — Auto-summarize and compress history\n` +
        `  /usage — Show token usage and estimated cost\n` +
        `  /model — Show which AI model is active\n` +
        `  /ping — Check if I'm alive\n\n` +
        `*💾 Memory:*\n` +
        `  Conversations saved to SQLite — I remember everything!\n\n` +
        `*🔍 Search & Tools:*\n` +
        `  I can search the web, run shell commands, and read/write files.\n\n` +
        `Just send me a message and I'll handle it. 🚀`,
        { parse_mode: "Markdown" }
    );
});

// ── /ping command ───────────────────────────────────────
bot.command("ping", async (ctx) => {
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const mins = Math.floor((uptime % 3600) / 60);
    const secs = Math.floor(uptime % 60);
    await ctx.reply(`🏓 Pong! Uptime: ${hours}h ${mins}m ${secs}s`);
});

// ── /status command ─────────────────────────────────────
bot.command("status", async (ctx) => {
    const chatId = ctx.chat.id;
    const uptimeMs = Date.now() - BOT_START_TIME;
    const hours = Math.floor(uptimeMs / 3_600_000);
    const mins = Math.floor((uptimeMs % 3_600_000) / 60_000);
    const secs = Math.floor((uptimeMs % 60_000) / 1000);
    const memMb = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const msgCount = countMessages(chatId);

    const { getPendingTasks } = await import("./scheduler.js");
    const taskCount = getPendingTasks(chatId).length;

    await ctx.reply(
        `🪐 **Gravity Claw — Status**\n\n` +
        `• Uptime: ${hours}h ${mins}m ${secs}s\n` +
        `• Heap: ${memMb} MB\n` +
        `• Model: \`${LLM_MODEL}\`\n` +
        `• Context: ${msgCount} msgs\n` +
        `• Reminders: ${taskCount} pending\n` +
        `• Node.js: ${process.version}\n`,
        { parse_mode: "Markdown" }
    );
});

// ── /model command ──────────────────────────────────────
bot.command("model", async (ctx) => {
    await ctx.reply(
        `🤖 **Current Model:** \`${LLM_MODEL}\`\n\n` +
        `To switch models, update \`AIML_MODEL\` in \`.env\` and restart.`,
        { parse_mode: "Markdown" }
    );
});

// ── /usage command ──────────────────────────────────────
bot.command("usage", async (ctx) => {
    const chatId = ctx.chat.id;
    const summary = getUsageSummary(chatId);
    await ctx.reply(summary, { parse_mode: "Markdown" }).catch(() =>
        ctx.reply(summary)
    );
});

// ── /new command (replaces /reset) ──────────────────────
bot.command("new", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    await ctx.reply("🧹 Conversation cleared. Fresh start! What's on your mind?");
});

// ── /reset command (alias for /new) ─────────────────────
bot.command("reset", async (ctx) => {
    const chatId = ctx.chat.id;
    clearHistory(chatId);
    await ctx.reply("🧹 Conversation history cleared. Fresh start!");
});

// ── /voice command — toggle TTS on/off ──────────────────
bot.command("voice", async (ctx) => {
    const chatId = ctx.chat.id;
    if (!isTTSAvailable()) {
        await ctx.reply("❌ ElevenLabs API key not set. Add ELEVENLABS_API_KEY to .env to enable voice mode.");
        return;
    }
    const current = isVoiceMode(chatId);
    voiceModeEnabled.set(chatId, !current);
    if (!current) {
        await ctx.reply(
            `🎙️ **Voice Mode ON** — Jacqueline will speak all responses.\n\n` +
            `Send /voice again to switch back to text.`,
            { parse_mode: "Markdown" }
        );
    } else {
        await ctx.reply("💬 **Voice Mode OFF** — back to text responses.", { parse_mode: "Markdown" });
    }
});

// ── /reminders command — list pending tasks ──────────────
bot.command("reminders", async (ctx) => {
    const chatId = ctx.chat.id;
    const { getPendingTasks } = await import("./scheduler.js");
    const tasks = getPendingTasks(chatId);

    if (tasks.length === 0) {
        await ctx.reply("📅 You have no pending reminders.");
        return;
    }

    let msg = "📅 **Upcoming Reminders:**\n\n";
    tasks.forEach((t, i) => {
        const timeStr = new Date(t.scheduled_at * 1000).toLocaleString();
        msg += `${i + 1}. \`${timeStr}\` — ${t.message}\n` +
            `   Discard: \`/cancel_${t.id}\`\n\n`;
    });

    await ctx.reply(msg, { parse_mode: "Markdown" });
});

// ── /cancel command — handles /cancel_{id} ───────────────
bot.command("cancel", async (ctx) => {
    // This handles both /cancel and /cancel_ID via a simple split
    const text = ctx.message?.text || "";
    const id = parseInt(text.split("_")[1]);

    if (isNaN(id)) {
        await ctx.reply("❓ Please provide a reminder ID, e.g., `/cancel_123`", { parse_mode: "Markdown" });
        return;
    }

    const { cancelTask } = await import("./scheduler.js");
    const success = cancelTask(ctx.chat.id, id);

    if (success) {
        await ctx.reply(`✅ Reminder #${id} cancelled.`);
    } else {
        await ctx.reply(`❌ Could not find active reminder #${id}.`);
    }
});

// ── /compact command — context pruning ──────────────────
bot.command("compact", async (ctx) => {
    const chatId = ctx.chat.id;
    const before = countMessages(chatId);

    if (before <= 10) {
        await ctx.reply(`💬 Only ${before} messages in history — no need to compact yet.`);
        return;
    }

    await ctx.replyWithChatAction("typing");

    // Ask the LLM to summarize the current conversation
    try {
        const summary = await runAgent(
            chatId,
            `Please summarize our conversation so far in 3-5 concise bullet points, capturing the key topics and decisions. ` +
            `After your summary, I'll compact the history to just keep the essentials.`
        );

        // Prune to last 10 messages after getting summary
        const pruned = pruneHistory(chatId, 10);
        const after = countMessages(chatId);

        await ctx.reply(
            `🗜️ **Context Compacted**\n\n` +
            `Removed ${pruned} older messages (${before} → ${after} kept).\n\n` +
            `**Summary of what we covered:**\n${summary}`,
            { parse_mode: "Markdown" }
        ).catch(() =>
            ctx.reply(`🗜️ Context compacted: ${before} → ${after} messages.`)
        );
    } catch (error) {
        const pruned = pruneHistory(chatId, 10);
        await ctx.reply(`🗜️ Compacted: removed ${pruned} older messages.`);
    }
});

// ── Helper: send response as text or voice ──────────────
async function sendResponse(ctx: any, chatId: number, response: string): Promise<void> {
    if (isVoiceMode(chatId) && isTTSAvailable()) {
        try {
            await ctx.replyWithChatAction("record_voice");
            const audioBuffer = await textToSpeech(response);
            await ctx.replyWithVoice(new InputFile(audioBuffer, "response.mp3"));
            return;
        } catch (ttsErr) {
            console.error("❌ TTS error, falling back to text:", ttsErr);
            // Fall through to text reply below
        }
    }
    // Text reply (with chunking for long responses)
    if (response.length <= 4096) {
        await ctx.reply(response, { parse_mode: "Markdown" }).catch(() => ctx.reply(response));
    } else {
        for (const chunk of splitMessage(response, 4000)) {
            await ctx.reply(chunk, { parse_mode: "Markdown" }).catch(() => ctx.reply(chunk));
        }
    }
}

// ── Voice message handler ─────────────────────────────
bot.on("message:voice", async (ctx) => {
    const chatId = ctx.chat.id;
    console.log(`  🎙️ Voice message received from ${chatId}`);

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
        await sendResponse(ctx, chatId, response);
    } catch (error) {
        console.error("❌ Voice handler error:", error);
        await ctx.reply(
            "⚠️ Sorry, I had trouble processing that voice message. " +
            "Could you try speaking again or send it as text?"
        );
    }
});

// ── Main message handler (text) ────────────────────────
bot.on("message:text", async (ctx) => {
    const chatId = ctx.chat.id;
    const text = ctx.message.text;

    await ctx.replyWithChatAction("typing");

    try {
        const response = await runAgent(chatId, text);
        await sendResponse(ctx, chatId, response);
    } catch (error) {
        console.error("❌ Agent error:", error);
        await ctx.reply(
            "⚠️ Something went wrong while processing your message. " +
            "Check the server logs for details."
        );
    }
});

// ── Error handler ───────────────────────────────────────
bot.catch((err) => {
    console.error("❌ Bot error:", err.error);
    console.error("   Context:", err.ctx?.update?.update_id);
});

// ── Helpers ─────────────────────────────────────────────
function splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxLength) {
            chunks.push(remaining);
            break;
        }

        let splitIndex = remaining.lastIndexOf("\n", maxLength);
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
            splitIndex = remaining.lastIndexOf(" ", maxLength);
        }
        if (splitIndex === -1 || splitIndex < maxLength / 2) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.substring(0, splitIndex));
        remaining = remaining.substring(splitIndex).trimStart();
    }

    return chunks;
}
