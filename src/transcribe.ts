/**
 * transcribe.ts — Speech-To-Text (STT) service
 * 
 * Logic to transcribe voice messages using the AIML API's STT endpoint.
 * Handles the two-step process:
 *   1. Upload audio and create transcription task
 *   2. Poll for the result until finished
 */

import { LLM_API_KEY, LLM_BASE_URL, LLM_TRANSCRIPTION_MODEL } from "./config.js";
import fs from "fs";

function logToFile(msg: string) {
    fs.appendFileSync("transcribe.log", `${new Date().toISOString()} ${msg}\n`);
}

/**
 * Transcribes an audio file from a URL.
 */
export async function transcribeAudio(audioUrl: string): Promise<string> {
    logToFile(`Creating task for model ${LLM_TRANSCRIPTION_MODEL} URL: ${audioUrl}`);
    console.log(`  🎙️ Creating transcription task for model ${LLM_TRANSCRIPTION_MODEL}...`);

    // 1. Create the task
    const createResponse = await fetch(`${LLM_BASE_URL}/stt/create`, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${LLM_API_KEY}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            model: LLM_TRANSCRIPTION_MODEL,
            url: audioUrl,
        }),
    });

    if (!createResponse.ok) {
        const errorText = await createResponse.text();
        logToFile(`FAILED to create task: ${createResponse.status} ${errorText}`);
        console.error(`  ❌ Failed to create STT task: ${createResponse.status}`);
        console.error(`  ❌ Error Body: ${errorText}`);
        throw new Error(`Failed to create STT task: ${createResponse.status} ${errorText}`);
    }

    const { generation_id } = await createResponse.json();
    console.log(`  ⏳ Transcription task created (ID: ${generation_id}). Polling for result...`);

    // 2. Poll for result
    const startTime = Date.now();
    const timeout = 120000; // 2 minute timeout

    while (Date.now() - startTime < timeout) {
        const statusResponse = await fetch(`${LLM_BASE_URL}/stt/${generation_id}`, {
            headers: {
                "Authorization": `Bearer ${LLM_API_KEY}`,
            },
        });

        if (!statusResponse.ok) {
            console.warn(`  ⚠️ Polling error: ${statusResponse.status}. Retrying...`);
            await new Promise(r => setTimeout(r, 1000));
            continue;
        }

        const data = await statusResponse.json();
        logToFile(`Poll Response: ${JSON.stringify(data)}`);

        // Success conditions
        const isDone = data.status === "completed" || data.status === "finished" || data.status === "success" || !!data.results;

        if (isDone) {
            logToFile(`SUCCESS: Transcription finished for ${generation_id}`);

            // Try different paths to find the transcript text
            const transcript =
                data.result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || // AIML + Deepgram
                data.results?.channels?.[0]?.alternatives?.[0]?.transcript ||          // Direct Deepgram
                data.result?.text ||                                                   // AIML + OpenAI
                data.results?.text ||                                                  // Some Whisper providers
                data.transcript ||                                                     // Simple providers
                data.text ||                                                           // OpenAI style
                (typeof data.results === 'string' ? data.results : null) ||
                (typeof data.result === 'string' ? data.result : null);

            if (!transcript) {
                logToFile(`ERROR: No text found in success response: ${JSON.stringify(data)}`);
                throw new Error("Transcription finished but no text found");
            }

            return transcript;
        }

        if (data.status === "failed" || data.status === "error" || data.error) {
            logToFile(`FAILED: ${JSON.stringify(data)}`);
            throw new Error(`Transcription failed: ${data.error || data.message || "Unknown error"}`);
        }

        // Wait before next poll (2 seconds is safer to avoid rate limits)
        await new Promise(r => setTimeout(r, 2000));
    }

    throw new Error("Transcription timed out after 2 minutes");
}
