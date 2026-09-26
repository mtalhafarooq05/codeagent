import { Ollama } from 'ollama';
import type { ToolDescriptor } from '../tools/types.js';
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
} from './types.js';

interface OllamaChatChunk {
  message: {
    content: string;
    tool_calls?: unknown[];
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeToolCall(value: unknown) {
  if (!isRecord(value) || !isRecord(value.function)) {
    throw new Error('Ollama returned a malformed tool call.');
  }
  const name = value.function.name;
  const arguments_ = value.function.arguments;
  if (typeof name !== 'string' || !name.trim() || !isRecord(arguments_)) {
    throw new Error('Ollama returned a malformed tool call.');
  }
  return { name, arguments: arguments_ };
}

interface OllamaClient {
  list(): Promise<{ models: Array<{ name: string }> }>;
  chat(request: Record<string, unknown>):
    | AsyncIterable<OllamaChatChunk>
    | Promise<AsyncIterable<OllamaChatChunk>>;
  abort(): void;
}

export class OllamaProvider implements ModelProvider {
  private readonly client: OllamaClient;

  constructor(
    readonly model: string,
    host: string,
    client?: OllamaClient,
  ) {
    this.client = client ?? (new Ollama({ host }) as unknown as OllamaClient);
  }

  async checkAvailability(): Promise<void> {
    let models: Awaited<ReturnType<OllamaClient['list']>>;
    try {
      models = await this.client.list();
    } catch (error) {
      throw new Error(
        'Could not reach local Ollama. Start Ollama and confirm its host URL.',
        { cause: error },
      );
    }

    if (!models.models.some((entry) => entry.name === this.model)) {
      throw new Error(
        `Ollama model "${this.model}" is not installed. Run: ollama pull ${this.model}`,
      );
    }
  }

  async *streamReply(
    messages: readonly ChatMessage[],
    tools: readonly ToolDescriptor[],
    signal: AbortSignal,
  ): AsyncIterable<ModelStreamEvent> {
    signal.throwIfAborted();
    const onAbort = () => this.client.abort();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const response = await this.client.chat({
        model: this.model,
        messages: messages.map((message) => ({
          role: message.role,
          content: message.content,
          ...(message.toolCalls
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
          ...(message.toolName ? { tool_name: message.toolName } : {}),
        })),
        tools: tools.map((tool) => ({
          type: 'function',
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        })),
        stream: true,
        think: false,
      });

      for await (const part of response) {
        signal.throwIfAborted();
        if (part.message.content) {
          yield { type: 'text', text: part.message.content };
        }
        for (const call of part.message.tool_calls ?? []) {
          const normalized = normalizeToolCall(call);
          yield {
            type: 'tool-call',
            call: normalized,
          };
        }
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
}
