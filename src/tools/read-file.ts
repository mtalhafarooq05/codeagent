import type { FileHandle } from 'node:fs/promises';
import { basename, relative } from 'node:path';
import { openProjectFile, PathPolicyError } from '../utils/path.js';
import type { Tool, ToolExecutionResult } from './types.js';

interface ReadFileArguments {
  path: string;
  startLine?: number;
  endLine?: number;
}

const MAX_LINES = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_OUTPUT_CHARACTERS = 32_000;
const READ_CHUNK_BYTES = 64 * 1024;

async function readBounded(
  handle: FileHandle,
  signal: AbortSignal,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(MAX_FILE_BYTES + 1);
  let offset = 0;

  while (offset < buffer.length) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      Math.min(READ_CHUNK_BYTES, buffer.length - offset),
      offset,
    );
    if (bytesRead === 0) break;
    offset += bytesRead;
  }

  signal.throwIfAborted();
  return buffer.subarray(0, offset);
}

function invalid(message: string): ToolExecutionResult {
  return { ok: false, error: { code: 'INVALID_ARGUMENTS', message } };
}

function binaryFile(): ToolExecutionResult {
  return {
    ok: false,
    error: {
      code: 'BINARY_FILE',
      message: 'Binary files cannot be read as text.',
    },
  };
}

function hasTooManyControlCharacters(text: string): boolean {
  let unsupported = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if ((code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127) {
      unsupported += 1;
    }
  }
  return unsupported > Math.max(4, text.length * 0.01);
}

function isSensitivePath(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name === '.npmrc' ||
    name === '.pypirc' ||
    name === 'id_rsa' ||
    name === 'id_ed25519' ||
    name.endsWith('.key') ||
    name.endsWith('.pem')
  );
}

export function createReadFileTool(projectRoot: string): Tool {
  return {
    name: 'read_file',
    description: 'Read a bounded range of lines from a text file inside the project.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description: 'Project-relative file path.',
        },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
    },
    async execute(
      value: Record<string, unknown>,
      signal: AbortSignal = new AbortController().signal,
    ): Promise<ToolExecutionResult> {
      signal.throwIfAborted();
      const parsed = value as unknown as ReadFileArguments;
      if (
        parsed.startLine !== undefined &&
        parsed.endLine !== undefined &&
        parsed.endLine < parsed.startLine
      ) {
        return invalid('endLine must be greater than or equal to startLine.');
      }

      if (isSensitivePath(parsed.path)) {
        return {
          ok: false,
          error: {
            code: 'SENSITIVE_FILE',
            message: 'Reading likely secret files is not allowed.',
          },
        };
      }

      let opened: Awaited<ReturnType<typeof openProjectFile>>;
      try {
        opened = await openProjectFile(projectRoot, parsed.path, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {
            ok: false,
            error: {
              code: 'FILE_NOT_FOUND',
              message: `File not found: ${parsed.path}.`,
            },
          };
        }
        if (error instanceof PathPolicyError) {
          return {
            ok: false,
            error: {
              code: 'PATH_NOT_ALLOWED',
              message: 'The requested path is not allowed.',
            },
          };
        }
        throw error;
      }
      try {
        const details = await opened.handle.stat();
        if (!details.isFile()) return invalid('path must reference a file.');
        if (details.size > MAX_FILE_BYTES) {
          return {
            ok: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'File exceeds the 1 MiB read limit.',
            },
          };
        }

        const bytes = await readBounded(opened.handle, signal);
        if (bytes.length > MAX_FILE_BYTES) {
          return {
            ok: false,
            error: {
              code: 'FILE_TOO_LARGE',
              message: 'File exceeds the 1 MiB read limit.',
            },
          };
        }
        if (bytes.includes(0)) return binaryFile();
        let text: string;
        try {
          text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return binaryFile();
        }
        if (hasTooManyControlCharacters(text)) return binaryFile();
        const normalized = text.replaceAll('\r\n', '\n');
        const split = normalized.split('\n');
        const lines = normalized.endsWith('\n') ? split.slice(0, -1) : split;
        const startLine = parsed.startLine ?? 1;
        if (startLine > lines.length) {
          return {
            ok: false,
            error: {
              code: 'LINE_OUT_OF_RANGE',
              message: `startLine ${startLine} is beyond the end of the file (${lines.length} lines).`,
            },
          };
        }
        const requestedEnd = parsed.endLine ?? lines.length;
        const selectedEndLine = Math.min(
          requestedEnd,
          lines.length,
          startLine + MAX_LINES - 1,
        );
        const selectedContent = lines
          .slice(startLine - 1, selectedEndLine)
          .join('\n');
        const content = selectedContent.slice(0, MAX_OUTPUT_CHARACTERS);
        const charactersTruncated = selectedContent.length > MAX_OUTPUT_CHARACTERS;
        const returnedLineCount = content ? content.split('\n').length : 0;
        const endLine = returnedLineCount
          ? startLine + returnedLineCount - 1
          : startLine - 1;
        const linesTruncated = selectedEndLine < Math.min(requestedEnd, lines.length);
        const truncated = linesTruncated || charactersTruncated;

        return {
          ok: true,
          value: {
            path: relative(opened.root, opened.target).replaceAll('\\', '/'),
            content,
            startLine,
            endLine,
            totalLines: lines.length,
            truncated,
            ...(truncated
              ? {
                  nextStartLine: charactersTruncated ? endLine : endLine + 1,
                }
              : {}),
          },
        };
      } finally {
        await opened.handle.close();
      }
    },
  };
}
