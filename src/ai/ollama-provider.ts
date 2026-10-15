import { type AIProvider, type Message, type ToolCall } from "./provider.js";
import { type ToolRegistry } from "../tools/registry.js";
import { type AgentSessionState } from "../tools/context.js";

interface ParsedToolCalls {
    calls: ToolCall[];
    lookedLikeToolCall: boolean;
}

function normalizeToolCall(value: any, registry: ToolRegistry): ToolCall | undefined {
    const source = value?.function || value;
    const name = source?.name;
    if (typeof name !== "string" || !registry.hasTool(name)) return undefined;

    let args = source.arguments;
    if (typeof args === "string") {
        try {
            args = JSON.parse(args);
        } catch {
            return undefined;
        }
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;

    return {
        ...(typeof value?.id === "string" ? { id: value.id } : {}),
        function: { name, arguments: args }
    };
}

function firstBalancedJsonValue(input: string): string | undefined {
    const objectStart = input.indexOf("{");
    const arrayStart = input.indexOf("[");
    const starts = [objectStart, arrayStart].filter(index => index >= 0);
    if (starts.length === 0) return undefined;

    const start = Math.min(...starts);
    const stack: string[] = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < input.length; index++) {
        const character = input[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }

        if (character === '"') {
            inString = true;
        } else if (character === "{" || character === "[") {
            stack.push(character);
        } else if (character === "}" || character === "]") {
            const expected = character === "}" ? "{" : "[";
            if (stack.pop() !== expected) return undefined;
            if (stack.length === 0) return input.slice(start, index + 1);
        }
    }
    return undefined;
}

function parseJsonCandidate(candidate: string, registry: ToolRegistry): ToolCall[] {
    const candidates = [candidate];
    const balanced = firstBalancedJsonValue(candidate);
    if (balanced && balanced !== candidate) candidates.push(balanced);

    for (const value of candidates) {
        try {
            const parsed = JSON.parse(value);
            const values = Array.isArray(parsed) ? parsed : [parsed];
            const calls = values
                .map(item => normalizeToolCall(item, registry))
                .filter((item): item is ToolCall => Boolean(item));
            if (calls.length > 0) return calls;
        } catch {
            // Try the balanced JSON value when the model adds trailing prose or delimiters.
        }
    }
    return [];
}

function parseTextToolCalls(content: string, registry: ToolRegistry): ParsedToolCalls {
    const trimmed = content.trim();
    if (!trimmed) return { calls: [], lookedLikeToolCall: false };

    const taggedMatches = Array.from(trimmed.matchAll(/<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g));
    if (taggedMatches.length > 0) {
        return {
            calls: taggedMatches.flatMap(match => parseJsonCandidate(match[1] || "", registry)),
            lookedLikeToolCall: true
        };
    }

    const fencedMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi));
    if (fencedMatches.length > 0) {
        const calls = fencedMatches.flatMap(match => parseJsonCandidate(match[1] || "", registry));
        return { calls: calls.slice(0, 1), lookedLikeToolCall: calls.length > 0 };
    }

    if ((trimmed.startsWith("{") && trimmed.endsWith("}"))
        || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
        const calls = parseJsonCandidate(trimmed, registry);
        return { calls, lookedLikeToolCall: calls.length > 0 };
    }

    return { calls: [], lookedLikeToolCall: trimmed.includes("<tool_call>") };
}

function readableLabel(key: string): string {
    return key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, value => value.toUpperCase());
}

function formatJsonValue(value: unknown, depth = 0): string {
    if (value === null || value === undefined) return "Not provided";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) {
        return value.map(item => `${"  ".repeat(depth)}- ${formatJsonValue(item, depth + 1)}`).join("\n");
    }
    return Object.entries(value as Record<string, unknown>)
        .map(([key, nested]) => {
            const formatted = formatJsonValue(nested, depth + 1);
            return typeof nested === "object" && nested !== null
                ? `**${readableLabel(key)}**\n\n${formatted}`
                : `- **${readableLabel(key)}:** ${formatted}`;
        })
        .join("\n");
}

function formatFinalContent(content: string): string {
    const trimmed = content.trim();
    const fencedMatch = trimmed.match(/^```json\s*([\s\S]*?)\s*```$/i);
    const candidate = fencedMatch?.[1] || trimmed;
    try {
        return formatJsonValue(JSON.parse(candidate));
    } catch {
        return trimmed;
    }
}

function summarizeArgs(args: Record<string, unknown>): string {
    const preferredKeys = ["filePath", "fileName", "query", "dirPath", "command"];
    const details = preferredKeys
        .filter(key => args[key] !== undefined)
        .map(key => `${key}="${String(args[key]).replace(/\s+/g, " ").slice(0, 120)}"`);
    return details.length ? ` (${details.join(", ")})` : "";
}

function factualSummary(state?: AgentSessionState): string {
    if (!state || state.changedFiles.size === 0) return "";
    const verificationStatus = !state.verificationRun
        ? "not run"
        : state.verificationPassed ? "passed" : "failed";
    const verification = state.verificationCommand
        ? `${verificationStatus} using \`${state.verificationCommand.replace(/`/g, "'")}\``
        : verificationStatus;
    return `### Recorded execution result

- Changed files: ${Array.from(state.changedFiles).sort().map(file => `\`${file}\``).join(", ")}
- Diff reviewed after the last edit: ${state.diffReviewed ? "yes" : "no"}
- Verification: ${verification}`;
}

export class OllamaProvider implements AIProvider {
    constructor(
        private modelName: string = "qwen2.5-coder",
        private baseUrl: string = "http://localhost:11434",
        private registry?: ToolRegistry | undefined,
        private sessionState?: AgentSessionState | undefined
    ) { }

    async generateResponse(messages: Message[]): Promise<string> {
        const currentMessages = [...messages];
        const maxIterations = 50;
        let verificationReminderSent = false;

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
            try {
                const payload: any = {
                    model: this.modelName,
                    messages: currentMessages,
                    stream: false,
                    options: {
                        temperature: 0.1,
                        seed: 0,
                        num_ctx: 8192
                    }
                };

                if (this.registry) {
                    const schemas = this.registry.getToolSchemas();
                    if (schemas.length > 0) payload.tools = schemas;
                }

                const response = await fetch(`${this.baseUrl}/api/chat`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    if (errorText.includes("model") && errorText.includes("not found")) {
                        throw new Error(`Model '${this.modelName}' not found in Ollama. Run: ollama run ${this.modelName}`);
                    }
                    throw new Error(`Ollama API error (${response.status}): ${errorText}`);
                }

                const data = await response.json() as { message?: Message };
                const aiMessage = data.message;
                if (!aiMessage || typeof aiMessage.content !== "string") {
                    throw new Error("Ollama returned a response without a valid message.");
                }

                if (/<\/?tool_response>/i.test(aiMessage.content)) {
                    const preview = aiMessage.content.replace(/\s+/g, " ").slice(0, 180);
                    console.log(`\n[Controller] Rejected model-authored <tool_response>: ${preview}`);
                    currentMessages.push({ role: "assistant", content: "" });
                    currentMessages.push({
                        role: "user",
                        content: "Do not fabricate or echo <tool_response> content. Only the controller can provide tool results. Call the required native tool now—for example, call read_file after find_path—and wait for its real result."
                    });
                    continue;
                }

                let toolCalls: ToolCall[] = [];
                if (this.registry) {
                    const nativeToolCallCount = aiMessage.tool_calls?.length || 0;
                    toolCalls = (aiMessage.tool_calls || [])
                        .map(call => normalizeToolCall(call, this.registry!))
                        .filter((call): call is ToolCall => Boolean(call));

                    if (nativeToolCallCount > 0 && toolCalls.length === 0) {
                        currentMessages.push({ role: "assistant", content: "" });
                        currentMessages.push({
                            role: "user",
                            content: "The previous native tool call was invalid or named an unavailable tool. Retry with one of the provided tool schemas and valid arguments."
                        });
                        continue;
                    }

                    if (toolCalls.length === 0) {
                        const parsed = parseTextToolCalls(aiMessage.content, this.registry);
                        toolCalls = parsed.calls;
                        if (parsed.lookedLikeToolCall && toolCalls.length === 0) {
                            currentMessages.push(aiMessage);
                            currentMessages.push({
                                role: "user",
                                content: "The previous tool call was malformed or named an unavailable tool. Retry using exactly one of the provided native tool schemas. Do not print tool-call JSON as prose."
                            });
                            continue;
                        }
                    }
                }

                if (toolCalls.length > 0 && this.registry) {
                    aiMessage.tool_calls = toolCalls;
                    aiMessage.content = "";
                    currentMessages.push(aiMessage);

                    for (const toolCall of toolCalls) {
                        const name = toolCall.function.name;
                        const args = toolCall.function.arguments;
                        console.log(`\n[Tool] ${name}${summarizeArgs(args)}`);
                        const result = await this.registry.executeTool(name, args);
                        if (name === "git_diff") console.log(`\n${result}`);
                        currentMessages.push({ role: "tool", content: result });
                    }
                    continue;
                }

                if (this.sessionState?.mutationExpected && this.sessionState.changedFiles.size === 0) {
                    const requiredAction = this.sessionState.readVersions.size === 0
                        ? "Call read_file on the exact relevant path, then use append_file to add a new function or edit_file to change existing text."
                        : "You have inspected files but have not made the requested change. Call append_file to add a new function, edit_file to change existing text, or create_file only if the user explicitly requested a new file.";
                    const preview = aiMessage.content.replace(/\s+/g, " ").slice(0, 180);
                    console.log(`\n[Controller] Rejected premature completion with no recorded change: ${preview}`);
                    currentMessages.push(aiMessage);
                    currentMessages.push({
                        role: "user",
                        content: `Controller requirement: this is a repository-change task, but no filesystem mutation has been recorded. ${requiredAction} Do not claim completion yet.`
                    });
                    continue;
                }

                if (this.sessionState?.changedFiles.size && !this.sessionState.diffReviewed) {
                    currentMessages.push(aiMessage);
                    currentMessages.push({
                        role: "user",
                        content: "Controller requirement: changes were made after the latest diff review. Call git_diff now, inspect it, then continue."
                    });
                    continue;
                }

                if (this.sessionState?.changedFiles.size
                    && !this.sessionState.verificationRun
                    && this.sessionState.recommendedVerificationCommand
                    && this.registry?.hasTool("run_command")) {
                    const command = this.sessionState.recommendedVerificationCommand;
                    const controllerCall: ToolCall = {
                        function: { name: "run_command", arguments: { command } }
                    };
                    console.log(`\n[Controller] Running detected verification command: ${command}`);
                    currentMessages.push({ role: "assistant", content: "", tool_calls: [controllerCall] });
                    const result = await this.registry.executeTool("run_command", { command });
                    currentMessages.push({ role: "tool", content: result });
                    continue;
                }

                if (this.sessionState?.changedFiles.size
                    && !this.sessionState.verificationRun
                    && !verificationReminderSent
                    && this.registry?.hasTool("run_command")) {
                    verificationReminderSent = true;
                    currentMessages.push(aiMessage);
                    currentMessages.push({
                        role: "user",
                        content: "Controller requirement: no verification command has been recorded after the latest edit. Run the most relevant existing test, type-check, lint, or build command. If none exists, explain that explicitly in the final response."
                    });
                    continue;
                }

                const formatted = formatFinalContent(aiMessage.content);
                const recorded = factualSummary(this.sessionState);
                return recorded ? `${recorded}\n\n### Agent summary\n\n${formatted}` : formatted;
            } catch (error: any) {
                if (error.cause?.code === "ECONNREFUSED" || error.message.includes("fetch failed")) {
                    throw new Error(`Could not connect to Ollama at ${this.baseUrl}. Ensure the Ollama app is running.`);
                }
                throw error;
            }
        }

        return "The agent stopped after reaching the tool-iteration limit. It did not claim completion because the required workflow was not finished.";
    }
}
