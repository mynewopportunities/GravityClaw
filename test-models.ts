import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

async function testModel(modelId: string) {
    console.log(`Testing model: ${modelId}`);
    try {
        const response = await client.chat.completions.create({
            model: modelId,
            messages: [{ role: "user", content: "hi" }],
            max_tokens: 10,
        });
        console.log(`✅ ${modelId} works! Response: ${response.choices[0].message.content}`);
        return true;
    } catch (error: any) {
        console.log(`❌ ${modelId} failed: ${error.message} (Status: ${error.status})`);
        return false;
    }
}

async function main() {
    const models = [
        "meta-llama/llama-3.3-70b-instruct:free",
        "google/gemma-3-27b-it:free",
        "arcee-ai/trinity-large-preview:free",
        "mistralai/mistral-7b-instruct:free",
        "meta-llama/llama-3.1-8b-instruct:free",
        "deepseek/deepseek-chat:free"
    ];

    for (const model of models) {
        await testModel(model);
        console.log("---");
    }
}

main();
