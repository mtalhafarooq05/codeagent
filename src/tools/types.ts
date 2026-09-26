export type ToolExecutionResult =
  | { ok: true; value: unknown }
  | { ok: false; error: { code: string; message: string } };

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  execute(arguments_: unknown, signal?: AbortSignal): Promise<ToolExecutionResult>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
