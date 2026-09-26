import type {
  Tool,
  ToolCall,
  ToolDescriptor,
  ToolExecutionResult,
} from './types.js';

export class ToolRegistry {
  private readonly tools: Map<string, Tool>;

  constructor(tools: readonly Tool[]) {
    this.tools = new Map();
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}.`);
      }
      this.tools.set(tool.name, tool);
    }
  }

  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async execute(
    call: ToolCall,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: 'TOOL_NOT_FOUND',
          message: `Unknown tool: ${call.name}.`,
        },
      };
    }

    try {
      signal.throwIfAborted();
      return await tool.execute(call.arguments, signal);
    } catch {
      return {
        ok: false,
        error: {
          code: 'TOOL_EXECUTION_FAILED',
          message: 'The tool failed unexpectedly.',
        },
      };
    }
  }
}
