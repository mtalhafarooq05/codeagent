import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectProject } from '../src/project/inspect.js';

const createdDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('inspectProject', () => {
  it('reports package metadata and skips dependency directories', async () => {
    const root = await mkdtemp(join(tmpdir(), 'local-code-agent-test-'));
    createdDirectories.push(root);
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'sample',
        type: 'module',
        packageManager: 'pnpm@10.0.0',
        scripts: { test: 'vitest run', build: 'tsc' },
        dependencies: { ollama: '^0.6.3' },
      }),
    );
    await writeFile(join(root, 'tsconfig.json'), '{}');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'index.ts'), 'export {};');
    await mkdir(join(root, 'node_modules'));
    await writeFile(join(root, 'node_modules', 'ignored.js'), '');

    const profile = await inspectProject(root);

    expect(profile.displayName).toBe('sample');
    expect(profile.packageManager).toBe('pnpm@10.0.0');
    expect(profile.moduleType).toBe('ES modules');
    expect(Object.keys(profile.scripts)).toHaveLength(2);
    expect(profile.dependencyCount).toBe(1);
    expect(profile.hasTypeScript).toBe(true);
    expect(profile.tree).toContain('src/index.ts');
    expect(profile.tree).not.toContain('node_modules/');
  });
});
