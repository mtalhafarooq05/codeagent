export interface Tool {
    /** The unique name of the tool */
    name: string;
    
    /** The schema object exactly as expected by the AI provider (e.g. Ollama/OpenAI format) */
    schema: any;
    
    /** The function to execute when the AI calls this tool */
    execute(args: any): Promise<string>;
}

export class ToolRegistry {
    private tools: Map<string, Tool> = new Map();

    /**
     * Registers a new tool in the registry.
     */
    registerTool(tool: Tool): void {
        this.tools.set(tool.name, tool);
    }

    /**
     * Retrieves the JSON schema for all registered tools.
     * This is passed directly into the AI's "tools" array in the API request.
     */
    getToolSchemas(): any[] {
        return Array.from(this.tools.values()).map(tool => tool.schema);
    }

    hasTool(name: string): boolean {
        return this.tools.has(name);
    }

    /**
     * Executes a tool by name with the given arguments.
     * Returns the string result of the tool execution.
     */
    async executeTool(name: string, args: any): Promise<string> {
        const tool = this.tools.get(name);
        if (!tool) {
            return `Error: Tool '${name}' is not registered.`;
        }

        try {
            return await tool.execute(args);
        } catch (error: any) {
            return `Error executing tool '${name}': ${error.message}`;
        }
    }
}
