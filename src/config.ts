/**
 * config.ts — Centralized configuration loader
 *
 * All secrets come from .env via dotenv. Nothing is hardcoded.
 * Fails fast with clear error messages if required vars are missing.
 */

import "dotenv/config";

function requireEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
        console.error(`❌ Missing required environment variable: ${key}`);
        console.error(`   → Copy .env.example to .env and fill in your values.`);
        process.exit(1);
    }
    return value;
}

function optionalEnv(key: string, fallback: string): string {
    return process.env[key] || fallback;
}

// ── Telegram ────────────────────────────────────────────
export const TELEGRAM_BOT_TOKEN = requireEnv("TELEGRAM_BOT_TOKEN");

// Comma-separated list of numeric Telegram user IDs
const rawIds = requireEnv("ALLOWED_USER_IDS");
export const ALLOWED_USER_IDS: number[] = rawIds
    .split(",")
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));

if (ALLOWED_USER_IDS.length === 0) {
    console.error(`❌ ALLOWED_USER_IDS must contain at least one valid numeric ID.`);
    process.exit(1);
}

// ── AIML API (LLM) ─────────────────────────────────────
export const LLM_API_KEY = requireEnv("AIML_API_KEY");
export const LLM_MODEL = optionalEnv(
    "AIML_MODEL",
    "claude-sonnet-4-6"
);
export const LLM_TRANSCRIPTION_MODEL = optionalEnv(
    "AIML_TRANSCRIPTION_MODEL",
    "#g1_whisper-large"
);
export const LLM_BASE_URL = "https://api.aimlapi.com/v1";

// ── Search ─────────────────────────────────────────────
export const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || null;

// ── Cartesia TTS (Phase 3) ──────────────────────────────
export const CARTESIA_API_KEY = process.env.CARTESIA_API_KEY || null;
// Default: Jacqueline - Reassuring Agent. Override with CARTESIA_VOICE_ID in .env
export const CARTESIA_VOICE_ID = process.env.CARTESIA_VOICE_ID || "9626c31c-bec5-4cca-baa8-f8ba9e84c8bc";

// ── Agent Safety ────────────────────────────────────────
export const MAX_AGENT_ITERATIONS = parseInt(
    optionalEnv("MAX_AGENT_ITERATIONS", "10"),
    10
);

// ── Vector Memory (Qdrant) ──────────────────────────────
export const QDRANT_URL = optionalEnv("QDRANT_URL", "http://localhost:6333");
export const VECTOR_MEMORY_ENABLED = optionalEnv("VECTOR_MEMORY_ENABLED", "true") === "true";

// ── Logging ─────────────────────────────────────────────
export function logConfig(): void {
    console.log("┌─────────────────────────────────────────────────┐");
    console.log("│            🪐 Gravity Claw — Config             │");
    console.log("├─────────────────────────────────────────────────┤");
    console.log(`│  Provider:    AIML API                          │`);
    console.log(`│  Model:       ${LLM_MODEL.padEnd(33)}│`);
    console.log(`│  Max iters:   ${String(MAX_AGENT_ITERATIONS).padEnd(33)}│`);
    console.log(`│  Allowed IDs: ${ALLOWED_USER_IDS.join(", ").padEnd(33)}│`);
    console.log(`│  Vector Mem:  ${QDRANT_URL.padEnd(33)}│`);
    console.log("│  Web server:  NONE (Telegram polling)           │");
    console.log("└─────────────────────────────────────────────────┘");
}
