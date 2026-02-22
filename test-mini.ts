import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: "8785595a65284b71820fae7a8fffcb80",
    baseURL: "https://api.aimlapi.com/v1",
});

async function main() {
    console.log("Testing gpt-4o-mini...");
    try {
        const response = await client.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 10,
        });
        console.log("✅ gpt-4o-mini works! Response:", response.choices[0].message.content);
    } catch (error: any) {
        console.error("❌ gpt-4o-mini failed:", error.message, "(Status:", error.status, ")");
    }
}

main();
