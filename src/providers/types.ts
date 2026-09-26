import type { ToolCall, ToolDescriptor } from '../tools/types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolName?: string;
}

export type ModelStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'tool-call'; call: ToolCall };

export interface ModelProvider {
  readonly model: string;
  checkAvailability(): Promise<void>;
  streamReply(
    messages: readonly ChatMessage[],
    tools: readonly ToolDescriptor[],
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent>;
}
