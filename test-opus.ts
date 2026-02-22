import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: "8785595a65284b71820fae7a8fffcb80",
    baseURL: "https://api.aimlapi.com/v1",
});

async function main() {
    console.log("Testing claude-opus-4-6...");
    try {
        const response = await client.chat.completions.create({
            model: "claude-opus-4-6",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 10,
        });
        console.log("✅ claude-opus-4-6 works! Response:", response.choices[0].message.content);
    } catch (error: any) {
        console.error("❌ claude-opus-4-6 failed:", error.message, "(Status:", error.status, ")");
    }
}

main();
