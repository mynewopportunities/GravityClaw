import "dotenv/config";

async function testSTT() {
    const API_KEY = process.env.AIML_API_KEY;
    const MODEL = "#g1_whisper-large";
    const SAMPLE_URL = "https://github.com/rafaelreis-hotmart/Audio-Sample-files/raw/master/sample.mp3";

    console.log("Testing AIML STT with public URL...");
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

        const status = createResponse.status;
        const body = await createResponse.text();
        console.log(`Create Status: ${status}`);
        console.log(`Create Response: ${body}`);

        if (status === 201 || status === 200) {
            const { generation_id } = JSON.parse(body);
            console.log(`Polling for ${generation_id}...`);
            // Poll once
            await new Promise(r => setTimeout(r, 2000));
            const pollResponse = await fetch(`https://api.aimlapi.com/v1/stt/${generation_id}`, {
                headers: { "Authorization": `Bearer ${API_KEY}` }
            });
            console.log(`Poll Status: ${pollResponse.status}`);
            console.log(`Poll Response: ${await pollResponse.text()}`);
        }
    } catch (e: any) {
        console.error("Test failed:", e.message);
    }
}

testSTT();
