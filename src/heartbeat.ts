/**
 * heartbeat.ts — Proactive Daily Accountability System
 * 
 * Sets up a recurring task that triggers at a specific time (e.g. 8 AM)
 * to reach out to the primary user with accountability questions.
 */

import { db } from "./db.js";
import { bot } from "./bot.js";
import {
    HEARTBEAT_ENABLED,
    HEARTBEAT_TIME,
    ALLOWED_USER_IDS
} from "./config.js";
import { runAgent } from "./agent.js";

/**
 * initHeartbeat — Starts the daily heartbeat monitor
 */
export function initHeartbeat(): void {
    if (!HEARTBEAT_ENABLED) {
        console.log("  💓 Heartbeat: Disabled via config.");
        return;
    }

    const primaryId = ALLOWED_USER_IDS[0];
    if (!primaryId) {
        console.warn("  ⚠️  Heartbeat: No ALLOWED_USER_IDS found. Heartbeat won't run.");
        return;
    }

    console.log(`  💓 Heartbeat: Initialized. Daily at ${HEARTBEAT_TIME} for user ${primaryId}`);

    // Check every minute
    setInterval(async () => {
        try {
            await checkHeartbeat(primaryId);
        } catch (error) {
            console.error("  ❌ Heartbeat error:", error);
        }
    }, 60000);
}

/**
 * checkHeartbeat — Internal logic to verify if it's time to send
 */
async function checkHeartbeat(primaryUserId: number): Promise<void> {
    const now = new Date();

    // Get HH:mm in local time
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    const currentTime = `${hours}:${minutes}`;

    if (currentTime !== HEARTBEAT_TIME) return;

    // Use the date string as a unique key for today to prevent double-sends on restart
    const today = now.toISOString().split('T')[0]; // YYYY-MM-DD

    const lastSent = getSetting(primaryUserId, "last_heartbeat_sent");
    if (lastSent === today) return;

    console.log(`  💓 Heartbeat: Target time ${HEARTBEAT_TIME} reached. Generating accountability message...`);

    // Instruction for the Agent
    const instruction = `[INTERNAL_TRIGGER: DAILY_HEARTBEAT]
It is 8:00 AM. Reach out to Moiz for his daily morning check-in.
Specifically, ask for accountability on:
1. "Have you tracked the emails which were sent yesterday night?"
2. "How many prospects filled in the N8N Lead Generation form?"

Apply your Soul: be direct, casual, mirror his vibe, and challenge his thinking. Don't be sycophantic. 
Use your memory of previous conversations to make the greeting feel natural and continuous.
Send ONLY the final message you want Moiz to read.`;

    try {
        // Run agent without saving this "instruction" to persistent memory history
        const message = await runAgent(primaryUserId, instruction, { skipStorage: true });

        if (message && message.trim().length > 0) {
            // Send via Telegram
            await bot.api.sendMessage(primaryUserId, message, {
                parse_mode: "Markdown"
            });

            // Persist the send status
            saveSetting(primaryUserId, "last_heartbeat_sent", today);
            console.log(`  ✅ Heartbeat: Successfully sent to ${primaryUserId}`);
        }
    } catch (err: any) {
        console.error("  ❌ Heartbeat delivery failed:", err.message);
    }
}

// ── Helpers ─────────────────────────────────────────────

function getSetting(chatId: number | string, key: string): string | null {
    try {
        const row = db.prepare("SELECT value FROM user_settings WHERE chat_id = ? AND key = ?").get(String(chatId), key) as any;
        return row ? row.value : null;
    } catch {
        return null;
    }
}

function saveSetting(chatId: number | string, key: string, value: string): void {
    db.prepare(`
        INSERT INTO user_settings (chat_id, key, value) 
        VALUES (?, ?, ?)
        ON CONFLICT(chat_id, key) DO UPDATE SET value = EXCLUDED.value
    `).run(String(chatId), key, value);
}
