/**
 * scheduler.ts — Background task worker
 *
 * Polling loop that checks for due reminders every 60 seconds
 * and sends them to the respective chats via Telegram or WhatsApp.
 */

import { bot } from "./bot.js";
import { db } from "./db.js";
import { sendWhatsAppMessage } from "./whatsapp.js";

interface Task {
    id: number;
    chat_id: string; // Changed from number to string for WhatsApp support
    message: string;
    scheduled_at: number;
}

export function initScheduler(): void {
    console.log("  ⏰ Scheduler: Background worker started (60s poll)");

    // Check for due tasks every minute
    setInterval(async () => {
        try {
            await checkDueTasks();
        } catch (error) {
            console.error("❌ Scheduler error:", error);
        }
    }, 60000);
}

async function checkDueTasks(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);

    // Find all uncompleted tasks where scheduled_at <= now
    const tasks = db.prepare(`
        SELECT id, chat_id, message, scheduled_at
        FROM scheduled_tasks
        WHERE is_completed = 0 AND scheduled_at <= ?
    `).all(now) as Task[];

    if (tasks.length === 0) return;

    console.log(`  ⏰ Scheduler: Executing ${tasks.length} due task(s)`);

    for (const task of tasks) {
        try {
            const cid = task.chat_id;

            // Route to correct channel
            if (cid.includes("@")) {
                // WhatsApp
                await sendWhatsAppMessage(cid, `🔔 *Reminder:* ${task.message}`);
            } else {
                // Telegram
                await bot.api.sendMessage(cid, `🔔 **Reminder:** ${task.message}`, {
                    parse_mode: "Markdown"
                });
            }

            // Mark as completed
            db.prepare("UPDATE scheduled_tasks SET is_completed = 1 WHERE id = ?").run(task.id);

            console.log(`  ✅ Reminder sent to ${cid}: ${task.message.substring(0, 30)}...`);
        } catch (error) {
            console.error(`❌ Failed to send reminder ${task.id}:`, error);
        }
    }
}

export function scheduleTask(chatId: string | number, message: string, time: Date): void {
    const timestamp = Math.floor(time.getTime() / 1000);
    const cid = String(chatId);

    db.prepare(`
        INSERT INTO scheduled_tasks (chat_id, message, scheduled_at)
        VALUES (?, ?, ?)
    `).run(cid, message, timestamp);

    console.log(`  📅 Scheduled task for ${cid} at ${time.toLocaleString()}: ${message.substring(0, 30)}...`);
}

export function getPendingTasks(chatId: string | number): Task[] {
    const cid = String(chatId);
    return db.prepare(`
        SELECT id, chat_id, message, scheduled_at
        FROM scheduled_tasks
        WHERE chat_id = ? AND is_completed = 0
        ORDER BY scheduled_at ASC
    `).all(cid) as Task[];
}

export function cancelTask(chatId: string | number, taskId: number): boolean {
    const cid = String(chatId);
    const result = db.prepare(`
        DELETE FROM scheduled_tasks
        WHERE id = ? AND chat_id = ? AND is_completed = 0
    `).run(taskId, cid);
    return result.changes > 0;
}
