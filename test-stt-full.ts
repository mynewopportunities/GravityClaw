import "dotenv/config";

async function testSTT() {
    const API_KEY = process.env.AIML_API_KEY;
    const MODEL = "#g1_whisper-large";
    const SAMPLE_URL = "https://github.com/rafaelreis-hotmart/Audio-Sample-files/raw/master/sample.mp3";

    try {
        const createResponse = await fetch("https://api.aimlapi.com/v1/stt/create", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${API_KEY}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: MODEL,
                url: SAMPLE_URL,
            }),
        });

        const body = await createResponse.json();
        const genId = body.generation_id;
        console.log(`Created: ${genId}`);

        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const pollResponse = await fetch(`https://api.aimlapi.com/v1/stt/${genId}`, {
                headers: { "Authorization": `Bearer ${API_KEY}` }
            });
            const pollData = await pollResponse.json();
            console.log(`Poll ${i}: ${pollData.status}`);
            if (pollData.status === "completed" || pollData.results) {
                console.log("Full Result:", JSON.stringify(pollData));
                break;
            }
        }
    } catch (e: any) {
        console.error("Test failed:", e.message);
    }
}

testSTT();
