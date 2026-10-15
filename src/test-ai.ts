import { OllamaProvider } from "./ai/ollama-provider.js";

async function run() {
    const ai = new OllamaProvider("qwen2.5-coder");

    console.log("Testing Ollama Connection...");
    
    try {
        const response = await ai.generateResponse([
            { role: "user", content: "Hello! Reply with exactly the word 'SUCCESS'." }
        ]);
        console.log(`\nResponse from AI: ${response}`);
    } catch (err: any) {
        console.error(`\nTest Failed:\n${err.message}`);
    }
}

run();
