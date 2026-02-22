/**
 * tools/index.ts — Tool barrel file
 *
 * Import this file to register all tools.
 * Each tool self-registers when imported.
 */

// ── Phase 1: Core Tools ──────────────────────────────────
import "./get-current-time.js";

// ── Phase 2: Web Search + Shell + File Ops ───────────────
import "./web-search.js";
import "./shell.js";
import "./file-ops.js";

// ── Phase 3: Voice, TTS ──────────────────────────────────
// Registered in bot.ts

// ── Phase 4: Reminders + Scheduled Tasks ──────────────────
import "./reminders.js";

// ── Phase 5 (coming): MCP Bridge ─────────────────────────
// import "./mcp-bridge.js";
