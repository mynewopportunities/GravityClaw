/**
 * tts.ts — Cartesia Text-to-Speech service
 *
 * Converts text to MP3 audio using Cartesia's sonic-2 model.
 * Returns a Buffer that can be sent as a Telegram voice message.
 *
 * Default voice: Serena - Laidback Girl (3ef78ba6-...)
 * Override: set CARTESIA_VOICE_ID in .env to any Cartesia voice ID.
 *
 * Features:
 *   - Strips markdown before speaking (no "**bold**" in audio)
 *   - Truncates very long responses to avoid excessive cost
 *   - Uses sonic-2 model (Cartesia's latest, best quality)
 */

import { CARTESIA_API_KEY, CARTESIA_VOICE_ID } from "./config.js";

const CARTESIA_API_VERSION = "2024-06-10";
const CARTESIA_TTS_URL = "https://api.cartesia.ai/tts/bytes";
const MAX_TTS_CHARS = 2000; // ~2 min of audio at normal pace

// ── Strip markdown for cleaner speech output ─────────────
function stripMarkdown(text: string): string {
    return text
        .replace(/\*\*(.*?)\*\*/g, "$1")    // **bold**
        .replace(/\*(.*?)\*/g, "$1")          // *italic*
        .replace(/```[\s\S]*?```/gm, "")      // ```code blocks```
        .replace(/`(.*?)`/g, "$1")            // `inline code`
        .replace(/#{1,6}\s+/g, "")            // # headings
        .replace(/\[(.*?)\]\(.*?\)/g, "$1")   // [links](url)
        .replace(/^>\s+/gm, "")               // > blockquotes
        .replace(/^[-•*]\s+/gm, "")           // bullet points
        .replace(/\n{3,}/g, "\n\n")           // excessive newlines
        .trim();
}

// ── Generate TTS Audio via Cartesia ──────────────────────
export async function textToSpeech(text: string): Promise<Buffer> {
    if (!CARTESIA_API_KEY) {
        throw new Error("CARTESIA_API_KEY is not set in .env");
    }

    const cleaned = stripMarkdown(text);
    const transcript = cleaned.length > MAX_TTS_CHARS
        ? cleaned.substring(0, MAX_TTS_CHARS) + "."
        : cleaned;

    console.log(`  🎙️ Cartesia TTS: "${transcript.substring(0, 60)}..." (${transcript.length} chars, voice: ${CARTESIA_VOICE_ID.substring(0, 8)}...)`);

    const res = await fetch(CARTESIA_TTS_URL, {
        method: "POST",
        headers: {
            "X-API-Key": CARTESIA_API_KEY,
            "Cartesia-Version": CARTESIA_API_VERSION,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            transcript,
            model_id: "sonic-2",
            voice: {
                mode: "id",
                id: CARTESIA_VOICE_ID,
            },
            output_format: {
                container: "mp3",
                bit_rate: 128000,
                sample_rate: 44100,
            },
            language: "en",
        }),
    });

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Cartesia API error: ${res.status} ${errText}`);
    }

    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    console.log(`  ✅ Cartesia: Generated ${(audioBuffer.length / 1024).toFixed(1)} KB of audio`);
    return audioBuffer;
}

// ── Check if TTS is available ─────────────────────────────
export function isTTSAvailable(): boolean {
    return !!CARTESIA_API_KEY;
}
