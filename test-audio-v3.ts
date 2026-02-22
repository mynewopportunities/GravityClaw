import OpenAI from "openai";
import "dotenv/config";
import fs from "fs";

async function testOpenAIAudio() {
    const client = new OpenAI({
        apiKey: process.env.AIML_API_KEY,
        baseURL: "https://api.aimlapi.com/v1",
    });

    console.log("Testing OpenAI-compatible transcription endpoint with #g1_whisper-large...");
    try {
        // We'll try to transcribing a local file if we can find one. 
        // For now, let's just check if the model is listed.
        const models = await client.models.list();
        const hasWhisper = models.data.some(m => m.id === "#g1_whisper-large");
        console.log(`Model #g1_whisper-large in list: ${hasWhisper}`);

        // Let's try to use the OpenAI SDK's transcription method.
        // We need a small .mp3 or similar.
    } catch (e: any) {
        console.error("Audio test failed:", error.message);
    }
}
