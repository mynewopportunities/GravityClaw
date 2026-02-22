/**
 * get-current-time.ts — Level 1 starter tool
 *
 * Returns the current date/time in the requested timezone.
 * Simple, safe, no side effects — perfect for testing the agentic loop.
 */

import { registerTool } from "./registry.js";

registerTool({
    name: "get_current_time",
    description:
        "Returns the current date and time. Optionally accepts a timezone (IANA format, e.g. 'America/New_York', 'Asia/Kolkata'). Defaults to the system timezone if not provided.",
    parameters: {
        type: "object",
        properties: {
            timezone: {
                type: "string",
                description:
                    "IANA timezone identifier (e.g. 'America/New_York', 'Europe/London', 'Asia/Kolkata'). Optional.",
            },
        },
        required: [],
    },
    execute: async (input) => {
        const tz = (input.timezone as string) || undefined;

        try {
            const now = new Date();
            const options: Intl.DateTimeFormatOptions = {
                weekday: "long",
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
                hour12: true,
                timeZoneName: "long",
            };

            if (tz) {
                options.timeZone = tz;
            }

            const formatted = new Intl.DateTimeFormat("en-US", options).format(now);
            const iso = now.toISOString();

            return JSON.stringify({
                formatted,
                iso,
                timezone: tz || Intl.DateTimeFormat().resolvedOptions().timeZone,
                unix: Math.floor(now.getTime() / 1000),
            });
        } catch (error) {
            if (error instanceof RangeError) {
                return JSON.stringify({
                    error: `Invalid timezone: "${tz}". Use IANA format like "America/New_York".`,
                });
            }
            throw error;
        }
    },
});
