import OpenAI from "openai";
import "dotenv/config";
import fs from "fs";

async function testOpenAIUpload() {
    const client = new OpenAI({
        apiKey: process.env.AIML_API_KEY,
        baseURL: "https://api.aimlapi.com/v1",
    });

    console.log("Testing OpenAI-style upload transcription...");
    try {
        const response = await client.audio.transcriptions.create({
            file: fs.createReadStream("test.mp3"),
            model: "whisper-1", // Many providers map whisper-1 to their best whisper model
        });
        console.log("✅ Success! Transcription:", response.text);
    } catch (e: any) {
        console.error("❌ Failed:", e.message);
    }
}

testOpenAIUpload();
