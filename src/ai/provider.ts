export interface ToolCall {
    id?: string;
    function: {
        name: string;
        arguments: Record<string, unknown>;
    };
}

export interface Message {
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    tool_calls?: ToolCall[];
}

export interface AIProvider {
    /**
     * Sends a list of messages to the AI and returns its response as a string.
     */
    generateResponse(messages: Message[]): Promise<string>;
}
