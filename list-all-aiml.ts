import OpenAI from "openai";
import "dotenv/config";

const client = new OpenAI({
    apiKey: "8785595a65284b71820fae7a8fffcb80",
    baseURL: "https://api.aimlapi.com/v1",
});

async function main() {
    try {
        const models = await client.models.list();
        console.log(`Total models: ${models.data.length}`);
        models.data.forEach(m => console.log(m.id));
    } catch (error: any) {
        console.error(`Error: ${error.message}`);
    }
}

main();
