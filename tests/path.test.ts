import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  openProjectDirectory,
  openProjectFile,
  resolveProjectPath,
} from '../src/utils/path.js';

const createdDirectories: string[] = [];

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'local-code-agent-path-'));
  createdDirectories.push(root);
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'example.ts'), 'export {};');
  return root;
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('resolveProjectPath', () => {
  it('resolves an existing project-relative file', async () => {
    const root = await createProject();

    await expect(resolveProjectPath(root, 'src/example.ts')).resolves.toBe(
      resolve(root, 'src', 'example.ts'),
    );
  });

  it('rejects traversal outside the project', async () => {
    const root = await createProject();

    await expect(resolveProjectPath(root, '../outside.txt')).rejects.toThrow(
      'outside the project',
    );
  });

  it('rejects absolute input paths', async () => {
    const root = await createProject();

    await expect(resolveProjectPath(root, resolve(root, 'src/example.ts'))).rejects.toThrow(
      'relative path',
    );
  });

  it('rejects paths containing a symbolic link', async () => {
    const root = await createProject();
    await mkdir(join(root, 'real'));
    await writeFile(join(root, 'real', 'linked.txt'), 'secret');
    await symlink(join(root, 'real'), join(root, 'linked'), 'junction');

    await expect(resolveProjectPath(root, 'linked/linked.txt')).rejects.toThrow(
      'symbolic links',
    );
  });
});

describe('openProjectFile', () => {
  it('returns a handle that stays attached to the validated file', async () => {
    const root = await createProject();
    const filePath = join(root, 'src', 'example.ts');
    const opened = await openProjectFile(root, 'src/example.ts');

    try {
      await rename(filePath, join(root, 'src', 'original.ts'));
      await writeFile(filePath, 'replacement');

      await expect(opened.handle.readFile({ encoding: 'utf8' })).resolves.toBe(
        'export {};',
      );
    } finally {
      await opened.handle.close();
    }
  });
});

describe('openProjectDirectory', () => {
  it('keeps enumerating the validated directory after its path is replaced', async () => {
    const root = await createProject();
    const outside = await mkdtemp(join(tmpdir(), 'local-code-agent-outside-'));
    createdDirectories.push(outside);
    await writeFile(join(outside, 'outside-secret.txt'), 'secret');
    const opened = await openProjectDirectory(root, 'src');

    try {
      await rename(join(root, 'src'), join(root, 'original-src'));
      await symlink(outside, join(root, 'src'), 'junction');
      const names: string[] = [];
      for await (const entry of opened.directory) names.push(entry.name);

      expect(names).toEqual(['example.ts']);
    } finally {
      await opened.directory.close().catch(() => undefined);
    }
  });
});
