import { OllamaProvider } from "./ai/ollama-provider.js";
import { type Message } from "./ai/provider.js";
import { ToolRegistry } from "./tools/registry.js";
import { readFileTool } from "./tools/read-file.js";

async function run() {
    const registry = new ToolRegistry();
    registry.registerTool(readFileTool);

    const ai = new OllamaProvider("qwen2.5-coder", "http://localhost:11434", registry);

    const messages: Message[] = [
        { role: "system", content: "You are a helpful assistant. You must use the read_file tool to answer the user's question." },
        { role: "user", content: "Please read the file src/tools/read-file.ts and tell me its contents." }
    ];

    console.log("Testing tool calling...");
    const response = await ai.generateResponse(messages);
    console.log("Final Response:\n" + response);
}

run();
