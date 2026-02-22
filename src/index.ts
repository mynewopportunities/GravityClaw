/**
 * index.ts — Entry point for Gravity Claw
 *
 * Boot sequence:
 *   1. Load and validate config (.env)
 *   2. Register all tools
 *   3. Start Telegram bot (long-polling)
 *
 * No web server. No exposed ports. Just Telegram polling.
 */

import { logConfig } from "./config.js";
import { getToolCount } from "./tools/registry.js";
import { bot } from "./bot.js";
import { initScheduler } from "./scheduler.js";
import { initMcp } from "./mcp/index.js";

// ── Initialize SQLite DB (creates tables if needed) ──────
import "./db.js";

// ── Register tools (side-effect imports) ────────────────
import "./tools/index.js";

// ── Boot ────────────────────────────────────────────────
async function main(): Promise<void> {
    console.log("");
    console.log("  🪐 Gravity Claw — Starting...");
    console.log("");

    // Show config (secrets are never printed)
    logConfig();
    console.log("");

    // Show registered tools
    console.log(`  📦 ${getToolCount()} tool(s) registered`);
    console.log("");

    // Start background scheduler
    initScheduler();

    // Initialize MCP Bridge
    await initMcp();

    // Initialize WhatsApp
    try {
        const { initWhatsApp } = await import("./whatsapp.js");
        await initWhatsApp();
    } catch (err) {
        console.error("  ❌ WhatsApp failed to start:", err);
    }

    // Start Telegram bot with long-polling (NOT webhooks)
    console.log("  📡 Connecting to Telegram (long-polling)...");
    await bot.start({
        onStart: (botInfo) => {
            console.log(`  ✅ Bot online: @${botInfo.username}`);
            console.log(`  💬 Send me a message on Telegram!`);
            console.log("");
        },
    });
}

// ── Graceful shutdown ───────────────────────────────────
function shutdown(signal: string): void {
    console.log(`\n  🛑 Received ${signal}. Shutting down gracefully...`);
    bot.stop();
    process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// ── Run ─────────────────────────────────────────────────
main().catch((error) => {
    console.error("💥 Fatal error:", error);
    process.exit(1);
});
