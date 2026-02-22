import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

async function main() {
    try {
        const models = await client.models.list();
        console.log("First 5 models returned by API:");
        models.data.slice(0, 5).forEach(m => console.log(`- ${m.id}`));

        const freeModels = models.data.filter(m => m.id.includes(":free"));
        console.log(`\nFound ${freeModels.length} free models.`);
        console.log("Top 10 free models:");
        freeModels.slice(0, 10).forEach(m => console.log(`- ${m.id}`));
    } catch (error: any) {
        console.error(`Error listing models: ${error.message} (Status: ${error.status})`);
    }
}

main();
