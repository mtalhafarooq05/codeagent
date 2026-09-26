import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createListDirectoryTool } from '../src/tools/list-directory.js';

const createdDirectories: string[] = [];

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'local-code-agent-list-'));
  createdDirectories.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('list_directory tool', () => {
  it('lists one level with directories first and skips noisy directories', async () => {
    const root = await createProject();
    await Promise.all([
      mkdir(join(root, 'src')),
      mkdir(join(root, 'tests')),
      mkdir(join(root, '.git')),
      mkdir(join(root, 'node_modules')),
      mkdir(join(root, 'dist')),
      writeFile(join(root, 'README.md'), 'read me'),
      writeFile(join(root, 'package.json'), '{}'),
    ]);
    await writeFile(join(root, 'src', 'hidden-by-depth.ts'), 'content');
    const tool = createListDirectoryTool(root);

    await expect(tool.execute({})).resolves.toEqual({
      ok: true,
      value: {
        path: '.',
        entries: [
          { name: 'src', path: 'src', type: 'directory' },
          { name: 'tests', path: 'tests', type: 'directory' },
          { name: 'package.json', path: 'package.json', type: 'file' },
          { name: 'README.md', path: 'README.md', type: 'file' },
        ],
        truncated: false,
      },
    });
  });

  it('returns a structured error for a path outside the project', async () => {
    const root = await createProject();
    const tool = createListDirectoryTool(root);

    await expect(tool.execute({ path: '..' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'PATH_NOT_ALLOWED',
        message: 'The requested path is not allowed.',
      },
    });
  });

  it('returns a structured error when the directory does not exist', async () => {
    const root = await createProject();
    const tool = createListDirectoryTool(root);

    await expect(tool.execute({ path: 'missing' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'DIRECTORY_NOT_FOUND',
        message: 'Directory not found: missing.',
      },
    });
  });

  it('returns a structured error when path points to a file', async () => {
    const root = await createProject();
    await writeFile(join(root, 'file.txt'), 'content');
    const tool = createListDirectoryTool(root);

    await expect(tool.execute({ path: 'file.txt' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'NOT_A_DIRECTORY',
        message: 'Path is not a directory: file.txt.',
      },
    });
  });

  it('limits directory results to 200 entries and reports truncation', async () => {
    const root = await createProject();
    for (let index = 0; index < 205; index += 1) {
      await writeFile(join(root, `a-${String(index).padStart(3, '0')}.txt`), '');
    }
    await mkdir(join(root, 'z-last-directory'));
    const tool = createListDirectoryTool(root);

    const result = await tool.execute({});

    expect(result).toMatchObject({ ok: true, value: { truncated: true } });
    if (result.ok) {
      const entries = (result.value as {
        entries: Array<{ name: string; type: string }>;
      }).entries;
      expect(entries).toHaveLength(200);
      expect(entries[0]).toEqual({
        name: 'z-last-directory',
        path: 'z-last-directory',
        type: 'directory',
      });
      expect(entries.at(-1)?.name).toBe('a-198.txt');
    }
  });
});
