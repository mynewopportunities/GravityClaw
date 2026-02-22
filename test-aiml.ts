import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: process.env.AIML_API_KEY,
    baseURL: "https://api.aimlapi.com/v1",
});

async function main() {
    console.log("Testing AIML API...");
    try {
        const response = await client.chat.completions.create({
            model: "anthropic/claude-3-5-sonnet-20240620",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 10,
        });
        console.log("✅ Success! Response:", response.choices[0].message.content);
    } catch (error: any) {
        console.error("❌ Failed:", error.message, "(Status:", error.status, ")");
        if (error.response) {
            console.error("Response body:", JSON.stringify(error.response.data, null, 2));
        }
    }
}

main();
