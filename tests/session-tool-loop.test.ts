import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatSession } from '../src/session.js';
import type { ProjectProfile } from '../src/project/inspect.js';
import type { ChatMessage, ModelProvider } from '../src/providers/types.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createReadFileTool } from '../src/tools/read-file.js';
import type { Tool } from '../src/tools/types.js';

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

function profile(root: string): ProjectProfile {
  return {
    root,
    displayName: 'sample',
    packageManager: 'npm',
    moduleType: 'ES modules',
    scripts: {},
    dependencyCount: 0,
    devDependencyCount: 0,
    hasTypeScript: true,
    workspace: false,
    tree: ['example.txt'],
    treeTruncated: false,
  };
}

class ToolCallingProvider {
  readonly model = 'fake';
  readonly calls: readonly ChatMessage[][] = [];
  private invocation = 0;

  async checkAvailability(): Promise<void> {}

  async *streamReply(messages: readonly ChatMessage[]): AsyncIterable<unknown> {
    (this.calls as ChatMessage[][]).push([...messages]);
    if (this.invocation++ === 0) {
      yield {
        type: 'tool-call',
        call: { name: 'read_file', arguments: { path: 'example.txt' } },
      };
      return;
    }
    yield { type: 'text', text: 'The file says hello.' };
  }
}

describe('ChatSession tool loop', () => {
  it('executes a requested tool and sends its result back to the model', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-code-agent-session-'));
    createdDirectories.push(root);
    await writeFile(join(root, 'example.txt'), 'hello');
    const provider = new ToolCallingProvider();
    const registry = new ToolRegistry([createReadFileTool(root)]);
    const session = new ChatSession(
      provider as unknown as ModelProvider,
      profile(root),
      registry,
    );

    const chunks: string[] = [];
    for await (const chunk of session.reply('What is in example.txt?', new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['The file says hello.']);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[1]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'assistant',
          toolCalls: [
            { name: 'read_file', arguments: { path: 'example.txt' } },
          ],
        }),
        expect.objectContaining({
          role: 'tool',
          toolName: 'read_file',
          content: expect.stringContaining('hello'),
        }),
      ]),
    );
  });

  it('rejects a response with too many tool calls before executing any of them', async () => {
    let executions = 0;
    const tool: Tool = {
      name: 'counted_tool',
      description: 'Count executions.',
      inputSchema: { type: 'object' },
      async execute() {
        executions += 1;
        return { ok: true, value: null };
      },
    };
    const provider: ModelProvider = {
      model: 'fake',
      async checkAvailability() {},
      async *streamReply() {
        for (let index = 0; index < 5; index += 1) {
          yield {
            type: 'tool-call' as const,
            call: { name: 'counted_tool', arguments: {} },
          };
        }
      },
    };
    const session = new ChatSession(
      provider,
      profile(process.cwd()),
      new ToolRegistry([tool]),
    );

    const consume = async () => {
      for await (const _chunk of session.reply(
        'Use the tool repeatedly.',
        new AbortController().signal,
      )) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow('Tool call limit exceeded');
    expect(executions).toBe(0);
  });

  it('limits the total number of tool calls across responses', async () => {
    let executions = 0;
    const tool: Tool = {
      name: 'counted_tool',
      description: 'Count executions.',
      inputSchema: { type: 'object' },
      async execute() {
        executions += 1;
        return { ok: true, value: null };
      },
    };
    const provider: ModelProvider = {
      model: 'fake',
      async checkAvailability() {},
      async *streamReply() {
        yield { type: 'tool-call' as const, call: { name: 'counted_tool', arguments: {} } };
        yield { type: 'tool-call' as const, call: { name: 'counted_tool', arguments: {} } };
      },
    };
    const session = new ChatSession(
      provider,
      profile(process.cwd()),
      new ToolRegistry([tool]),
    );

    const consume = async () => {
      for await (const _chunk of session.reply(
        'Keep using tools.',
        new AbortController().signal,
      )) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow('Tool call limit exceeded');
    expect(executions).toBe(8);
  });

  it('stops before the next queued tool call when the request is cancelled', async () => {
    const controller = new AbortController();
    const executed: string[] = [];
    const makeTool = (name: string, abort = false): Tool => ({
      name,
      description: name,
      inputSchema: { type: 'object' },
      async execute() {
        executed.push(name);
        if (abort) controller.abort();
        return { ok: true, value: null };
      },
    });
    let invocation = 0;
    const provider: ModelProvider = {
      model: 'fake',
      async checkAvailability() {},
      async *streamReply() {
        if (invocation++ === 0) {
          yield { type: 'tool-call' as const, call: { name: 'first', arguments: {} } };
          yield { type: 'tool-call' as const, call: { name: 'second', arguments: {} } };
          return;
        }
        yield { type: 'text' as const, text: 'should not be reached' };
      },
    };
    const session = new ChatSession(
      provider,
      profile(process.cwd()),
      new ToolRegistry([makeTool('first', true), makeTool('second')]),
    );

    const consume = async () => {
      for await (const _chunk of session.reply('Cancel.', controller.signal)) {
        // Consume the stream.
      }
    };

    await expect(consume()).rejects.toThrow();
    expect(executed).toEqual(['first']);
  });

  it('does not display interim text from a response that requests a tool', async () => {
    let invocation = 0;
    const provider: ModelProvider = {
      model: 'fake',
      async checkAvailability() {},
      async *streamReply() {
        if (invocation++ === 0) {
          yield { type: 'text' as const, text: 'Unverified interim claim.' };
          yield {
            type: 'tool-call' as const,
            call: { name: 'missing_tool', arguments: {} },
          };
          return;
        }
        yield { type: 'text' as const, text: 'Final answer after the tool result.' };
      },
    };
    const session = new ChatSession(
      provider,
      profile(process.cwd()),
      new ToolRegistry([]),
    );

    const chunks: string[] = [];
    for await (const chunk of session.reply(
      'Try reading a file.',
      new AbortController().signal,
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['Final answer after the tool result.']);
  });
});
