import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: process.env.AIML_API_KEY,
    baseURL: "https://api.aimlapi.com/v1",
});

async function main() {
    try {
        const models = await client.models.list();
        console.log("Available models (first 20):");
        models.data.slice(0, 20).forEach(m => console.log(`- ${m.id}`));
    } catch (error: any) {
        console.error(`Error listing models: ${error.message}`);
    }
}

main();
