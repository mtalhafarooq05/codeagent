import { Ajv, type ValidateFunction } from 'ajv';
import type {
  Tool,
  ToolCall,
  ToolDescriptor,
  ToolExecutionResult,
} from './types.js';

export class ToolRegistry {
  private readonly ajv: Ajv;
  private readonly tools: Map<string, Tool>;
  private readonly validators: Map<string, ValidateFunction>;

  constructor(tools: readonly Tool[]) {
    this.ajv = new Ajv({ allErrors: true });
    this.tools = new Map();
    this.validators = new Map();
    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Duplicate tool name: ${tool.name}.`);
      }
      this.tools.set(tool.name, tool);
      this.validators.set(tool.name, this.ajv.compile(tool.inputSchema));
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

    const validate = this.validators.get(call.name);
    if (!validate || !validate(call.arguments)) {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: `Invalid tool arguments: ${this.ajv.errorsText(validate?.errors)}.`,
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
