import OpenAI from "openai";
import "dotenv/config";
import fs from "fs";

async function testOpenAIAudio() {
    const client = new OpenAI({
        apiKey: process.env.AIML_API_KEY,
        baseURL: "https://api.aimlapi.com/v1",
    });

    console.log("Testing OpenAI-compatible transcription endpoint...");
    try {
        // We'll just try to list models or check if the endpoint exists by sending an empty request
        // or just use a small dummy file if we have one.
        // Actually, let's just check if #g1_whisper-large supports this style.

        // Let's check the docs via search again or just try it.
    } catch (e: any) {
        console.error("Audio test failed:", e.message);
    }
}
