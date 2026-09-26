import { describe, expect, it } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama-provider.js';
import type { ChatMessage } from '../src/providers/types.js';
import type { ToolDescriptor } from '../src/tools/types.js';

class FakeOllamaClient {
  request: Record<string, unknown> | undefined;

  async list() {
    return { models: [{ name: 'qwen3:8b' }] };
  }

  async *chat(request: Record<string, unknown>) {
    this.request = request;
    yield {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            function: {
              name: 'read_file',
              arguments: { path: 'src/session.ts' },
            },
          },
        ],
      },
    };
  }

  abort() {}
}

describe('OllamaProvider tool support', () => {
  it('sends tool descriptors and yields normalized tool calls', async () => {
    const client = new FakeOllamaClient();
    const provider = new OllamaProvider(
      'qwen3:8b',
      'http://127.0.0.1:11434',
      client,
    );
    const messages: ChatMessage[] = [{ role: 'user', content: 'Read session.ts' }];
    const tools: ToolDescriptor[] = [
      {
        name: 'read_file',
        description: 'Read a file.',
        inputSchema: {
          type: 'object',
          required: ['path'],
          properties: { path: { type: 'string' } },
        },
      },
    ];

    const events = [];
    for await (const event of provider.streamReply(
      messages,
      tools,
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(client.request).toMatchObject({
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Read a file.',
            parameters: tools[0]?.inputSchema,
          },
        },
      ],
    });
    expect(events).toEqual([
      {
        type: 'tool-call',
        call: { name: 'read_file', arguments: { path: 'src/session.ts' } },
      },
    ]);
  });

  it('rejects malformed tool calls with a controlled provider error', async () => {
    const client = {
      async list() {
        return { models: [{ name: 'qwen3:8b' }] };
      },
      async *chat() {
        yield {
          message: {
            content: '',
            tool_calls: [{ function: { name: '', arguments: 'not-an-object' } }],
          },
        };
      },
      abort() {},
    };
    const provider = new OllamaProvider(
      'qwen3:8b',
      'http://127.0.0.1:11434',
      client as never,
    );

    const consume = async () => {
      for await (const _event of provider.streamReply(
        [{ role: 'user', content: 'Read a file.' }],
        [],
        new AbortController().signal,
      )) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow(
      'Ollama returned a malformed tool call.',
    );
  });
});
