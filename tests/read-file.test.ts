import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadFileTool } from '../src/tools/read-file.js';
import { ToolRegistry } from '../src/tools/registry.js';

const createdDirectories: string[] = [];

async function createProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'local-code-agent-read-'));
  createdDirectories.push(root);
  await mkdir(join(root, 'src'));
  return root;
}

afterEach(async () => {
  await Promise.all(
    createdDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('read_file tool', () => {
  it('reads the requested inclusive line range', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'example.ts'), 'first\nsecond\nthird\nfourth\n');
    const tool = createReadFileTool(root);

    await expect(
      tool.execute({ path: 'src/example.ts', startLine: 2, endLine: 3 }),
    ).resolves.toEqual({
      ok: true,
      value: {
        path: 'src/example.ts',
        content: 'second\nthird',
        startLine: 2,
        endLine: 3,
        totalLines: 4,
        truncated: false,
      },
    });
  });

  it('reports a project-relative path when the project root is a junction', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'local-code-agent-root-link-'));
    createdDirectories.push(parent);
    const realRoot = join(parent, 'real');
    const linkedRoot = join(parent, 'linked');
    await mkdir(join(realRoot, 'src'), { recursive: true });
    await writeFile(join(realRoot, 'src', 'example.ts'), 'content');
    await symlink(realRoot, linkedRoot, 'junction');
    const tool = createReadFileTool(linkedRoot);

    await expect(tool.execute({ path: 'src/example.ts' })).resolves.toMatchObject({
      ok: true,
      value: { path: 'src/example.ts' },
    });
  });

  it('returns a structured error for an invalid line range', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'example.ts'), 'first\nsecond');
    const tool = createReadFileTool(root);

    await expect(
      tool.execute({ path: 'src/example.ts', startLine: 3, endLine: 2 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'INVALID_ARGUMENTS',
        message: 'endLine must be greater than or equal to startLine.',
      },
    });
  });

  it('returns a structured error when startLine is beyond the file', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'example.ts'), 'first\nsecond');
    const tool = createReadFileTool(root);

    await expect(
      tool.execute({ path: 'src/example.ts', startLine: 3 }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'LINE_OUT_OF_RANGE',
        message: 'startLine 3 is beyond the end of the file (2 lines).',
      },
    });
  });

  it('limits default output to 200 lines and reports truncation', async () => {
    const root = await createProject();
    const lines = Array.from({ length: 205 }, (_, index) => `line ${index + 1}`);
    await writeFile(join(root, 'src', 'large.ts'), lines.join('\n'));
    const tool = createReadFileTool(root);

    const result = await tool.execute({ path: 'src/large.ts' });

    expect(result).toMatchObject({
      ok: true,
      value: {
        startLine: 1,
        endLine: 200,
        totalLines: 205,
        truncated: true,
      },
    });
    if (result.ok) {
      expect((result.value as { content: string }).content.split('\n')).toHaveLength(200);
    }
  });

  it.each([
    [{ path: '' }, 'path must be a non-empty string.'],
    [{ path: '   ' }, 'path must be a non-empty string.'],
    [{ path: 'src/example.ts', startLine: 0 }, 'startLine must be a positive integer.'],
    [{ path: 'src/example.ts', endLine: 1.5 }, 'endLine must be a positive integer.'],
    [{ path: 'src/example.ts', extra: true }, 'Unknown argument: extra.'],
  ])('rejects malformed arguments %#', async (arguments_) => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'example.ts'), 'first\nsecond');
    const registry = new ToolRegistry([createReadFileTool(root)]);

    await expect(
      registry.execute({ name: 'read_file', arguments: arguments_ }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_ARGUMENTS' },
    });
  });

  it('returns a structured error when the file does not exist', async () => {
    const root = await createProject();
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: 'src/missing.ts' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'FILE_NOT_FOUND',
        message: 'File not found: src/missing.ts.',
      },
    });
  });

  it('returns a structured error for paths outside the project', async () => {
    const root = await createProject();
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: '../secret.txt' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'PATH_NOT_ALLOWED',
        message: 'The requested path is not allowed.',
      },
    });
  });

  it('refuses likely secret files', async () => {
    const root = await createProject();
    await writeFile(join(root, '.env'), 'API_KEY=do-not-read');
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: '.env' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'SENSITIVE_FILE',
        message: 'Reading likely secret files is not allowed.',
      },
    });
  });

  it.each(['.npmrc', 'private.key', 'id_rsa'])(
    'refuses the common credential file %s',
    async (fileName) => {
      const root = await createProject();
      await writeFile(join(root, fileName), 'credential');
      const tool = createReadFileTool(root);

      await expect(tool.execute({ path: fileName })).resolves.toMatchObject({
        ok: false,
        error: { code: 'SENSITIVE_FILE' },
      });
    },
  );

  it('refuses binary files', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'binary.dat'), Buffer.from([0, 1, 2, 3]));
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: 'src/binary.dat' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'BINARY_FILE',
        message: 'Binary files cannot be read as text.',
      },
    });
  });

  it('refuses bytes that are not valid UTF-8 text', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'src', 'invalid-utf8.txt'),
      Buffer.from([0x66, 0x6f, 0x80, 0x6f]),
    );
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: 'src/invalid-utf8.txt' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'BINARY_FILE',
        message: 'Binary files cannot be read as text.',
      },
    });
  });

  it('refuses files larger than one MiB', async () => {
    const root = await createProject();
    await writeFile(join(root, 'src', 'huge.txt'), 'a'.repeat(1024 * 1024 + 1));
    const tool = createReadFileTool(root);

    await expect(tool.execute({ path: 'src/huge.txt' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        message: 'File exceeds the 1 MiB read limit.',
      },
    });
  });

  it('limits returned text to 32000 characters', async () => {
    const root = await createProject();
    await writeFile(
      join(root, 'src', 'long-line.txt'),
      `${'a'.repeat(20_000)}\n${'b'.repeat(20_000)}\nthird`,
    );
    const tool = createReadFileTool(root);

    const result = await tool.execute({ path: 'src/long-line.txt' });

    expect(result).toMatchObject({ ok: true, value: { truncated: true } });
    if (result.ok) {
      expect((result.value as { content: string }).content).toHaveLength(32_000);
      expect(result.value).toMatchObject({
        endLine: 2,
        nextStartLine: 2,
      });
    }
  });
});
