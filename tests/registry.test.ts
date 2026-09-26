import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('ToolRegistry', () => {
  it('exposes tool metadata and dispatches execution by name', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-code-agent-registry-'));
    createdDirectories.push(root);
    await writeFile(join(root, 'example.txt'), 'hello');
    const registry = new ToolRegistry([createReadFileTool(root)]);

    expect(registry.descriptors()).toEqual([
      expect.objectContaining({
        name: 'read_file',
        description: expect.any(String),
        inputSchema: expect.objectContaining({ type: 'object' }),
      }),
    ]);
    await expect(
      registry.execute({ name: 'read_file', arguments: { path: 'example.txt' } }),
    ).resolves.toMatchObject({ ok: true, value: { content: 'hello' } });
  });

  it('returns a structured error for an unknown tool', async () => {
    const registry = new ToolRegistry([]);

    await expect(
      registry.execute({ name: 'missing_tool', arguments: {} }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TOOL_NOT_FOUND',
        message: 'Unknown tool: missing_tool.',
      },
    });
  });

  it('rejects arguments that do not match the tool schema before execution', async () => {
    let executions = 0;
    const tool: Tool = {
      name: 'string_path_tool',
      description: 'Accepts a string path.',
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['path'],
        properties: { path: { type: 'string', minLength: 1 } },
      },
      async execute() {
        executions += 1;
        return { ok: true, value: null };
      },
    };
    const registry = new ToolRegistry([tool]);

    await expect(
      registry.execute({ name: 'string_path_tool', arguments: { path: 42 } }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: expect.stringContaining('must be string'),
      },
    });
    expect(executions).toBe(0);
  });

  it('rejects duplicate tool names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-code-agent-registry-'));
    createdDirectories.push(root);

    expect(
      () => new ToolRegistry([createReadFileTool(root), createReadFileTool(root)]),
    ).toThrow('Duplicate tool name: read_file.');
  });

  it('contains unexpected tool failures', async () => {
    const brokenTool: Tool = {
      name: 'broken',
      description: 'Always fails.',
      inputSchema: { type: 'object' },
      async execute() {
        throw new Error('private filesystem detail');
      },
    };
    const registry = new ToolRegistry([brokenTool]);

    await expect(
      registry.execute({ name: 'broken', arguments: {} }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: 'The tool failed unexpectedly.',
      },
    });
  });
});
