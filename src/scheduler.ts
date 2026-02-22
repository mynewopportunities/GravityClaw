/**
 * scheduler.ts — Background task worker
 *
 * Polling loop that checks for due reminders every 60 seconds
 * and sends them to the respective chats via the Telegram bot.
 */

import { bot } from "./bot.js";
import { db } from "./db.js";

interface Task {
    id: number;
    chat_id: number;
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
            // Send the reminder message
            await bot.api.sendMessage(task.chat_id, `🔔 **Reminder:** ${task.message}`, {
                parse_mode: "Markdown"
            });

            // Mark as completed
            db.prepare("UPDATE scheduled_tasks SET is_completed = 1 WHERE id = ?").run(task.id);

            console.log(`  ✅ Reminder sent to ${task.chat_id}: ${task.message.substring(0, 30)}...`);
        } catch (error) {
            console.error(`❌ Failed to send reminder ${task.id}:`, error);
        }
    }
}

export function scheduleTask(chatId: number, message: string, time: Date): void {
    const timestamp = Math.floor(time.getTime() / 1000);

    db.prepare(`
        INSERT INTO scheduled_tasks (chat_id, message, scheduled_at)
        VALUES (?, ?, ?)
    `).run(chatId, message, timestamp);

    console.log(`  📅 Scheduled task for ${chatId} at ${time.toLocaleString()}: ${message.substring(0, 30)}...`);
}

export function getPendingTasks(chatId: number): Task[] {
    return db.prepare(`
        SELECT id, chat_id, message, scheduled_at
        FROM scheduled_tasks
        WHERE chat_id = ? AND is_completed = 0
        ORDER BY scheduled_at ASC
    `).all(chatId) as Task[];
}

export function cancelTask(chatId: number, taskId: number): boolean {
    const result = db.prepare(`
        DELETE FROM scheduled_tasks
        WHERE id = ? AND chat_id = ? AND is_completed = 0
    `).run(taskId, chatId);
    return result.changes > 0;
}
