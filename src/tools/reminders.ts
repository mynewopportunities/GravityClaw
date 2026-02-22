/**
 * reminders.ts — Reminder tool for the agent
 */

import { registerTool } from "./registry.js";
import { scheduleTask } from "../scheduler.js";
import { addMinutes, addHours, addDays, isPast } from "date-fns";

// A simple natural language time parser would be better, 
// but for now we'll handle relative offsets and absolute times via simple logic.
function parseReminderTime(input: string): Date | null {
    const now = new Date();

    // Check for "in X minutes/hours/days"
    const relativeMatch = input.match(/in (\d+) (minute|hour|day)s?/i);
    if (relativeMatch) {
        const value = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].toLowerCase();

        if (unit.startsWith("minute")) return addMinutes(now, value);
        if (unit.startsWith("hour")) return addHours(now, value);
        if (unit.startsWith("day")) return addDays(now, value);
    }

    // Check for "tomorrow"
    if (input.toLowerCase() === "tomorrow") {
        return addDays(now, 1);
    }

    // Try native date parsing
    const date = new Date(input);
    if (!isNaN(date.getTime())) {
        return date;
    }

    return null;
}

registerTool({
    name: "set_reminder",
    description: "Set a reminder for the user. Works with relative times like 'in 5 minutes' or absolute times.",
    parameters: {
        type: "object",
        properties: {
            message: {
                type: "string",
                description: "The reminder message content."
            },
            time: {
                type: "string",
                description: "When to remind (e.g., 'in 10 minutes', 'tomorrow at 9am', '2024-12-25 10:00')"
            }
        },
        required: ["message", "time"]
    },
    execute: async (args: Record<string, any>) => {
        const { message, time } = args;
        const chatId = args.chatId; // Injected by the agent loop

        if (!chatId) return "Error: Could not determine chat ID for reminder.";

        const date = parseReminderTime(time);
        if (!date) return `Error: Could not parse time "${time}". Try something like "in 5 minutes".`;
        if (isPast(date)) return "Error: Cannot set a reminder in the past.";

        scheduleTask(chatId, message, date);

        return `✅ Reminder set for ${date.toLocaleString()}: "${message}"`;
    }
});
