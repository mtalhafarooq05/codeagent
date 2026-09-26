import { describe, expect, it } from 'vitest';
import { ChatSession } from '../src/session.js';
import type { ProjectProfile } from '../src/project/inspect.js';
import type {
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
} from '../src/providers/types.js';
import { ToolRegistry } from '../src/tools/registry.js';

function profile(displayName: string): ProjectProfile {
  return {
    root: '/project',
    displayName,
    packageManager: 'npm',
    moduleType: 'ES modules',
    scripts: { test: 'vitest run' },
    dependencyCount: 1,
    devDependencyCount: 1,
    hasTypeScript: true,
    workspace: false,
    tree: ['package.json'],
    treeTruncated: false,
  };
}

class FakeProvider implements ModelProvider {
  readonly model = 'fake';
  lastMessages: readonly ChatMessage[] = [];

  async checkAvailability(): Promise<void> {}

  async *streamReply(messages: readonly ChatMessage[]): AsyncIterable<ModelStreamEvent> {
    this.lastMessages = messages;
    yield { type: 'text', text: 'Hello' };
    yield { type: 'text', text: ' there' };
  }
}

describe('ChatSession', () => {
  it('keeps provider-independent history and refreshes project metadata', async () => {
    const provider = new FakeProvider();
    const session = new ChatSession(provider, profile('old-name'), new ToolRegistry([]));
    const chunks: string[] = [];
    for await (const chunk of session.reply('Hi', new AbortController().signal)) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('Hello there');
    expect(provider.lastMessages[0]?.role).toBe('system');
    expect(provider.lastMessages[1]?.content).toContain('old-name');

    session.updateProfile(profile('new-name'));
    for await (const _ of session.reply('Again', new AbortController().signal)) {
      // Drain the response to commit conversation history.
    }

    expect(provider.lastMessages[1]?.content).toContain('new-name');
    expect(provider.lastMessages[3]).toEqual({ role: 'assistant', content: 'Hello there' });
  });
});
