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

function parseArguments(value: unknown): ReadFileArguments | ToolExecutionResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('Arguments must be an object.');
  }

  const arguments_ = value as Record<string, unknown>;
  const allowed = new Set(['path', 'startLine', 'endLine']);
  const unknown = Object.keys(arguments_).find((key) => !allowed.has(key));
  if (unknown) return invalid(`Unknown argument: ${unknown}.`);

  if (typeof arguments_.path !== 'string' || !arguments_.path.trim()) {
    return invalid('path must be a non-empty string.');
  }

  if (
    arguments_.startLine !== undefined &&
    (!Number.isInteger(arguments_.startLine) || (arguments_.startLine as number) < 1)
  ) {
    return invalid('startLine must be a positive integer.');
  }

  if (
    arguments_.endLine !== undefined &&
    (!Number.isInteger(arguments_.endLine) || (arguments_.endLine as number) < 1)
  ) {
    return invalid('endLine must be a positive integer.');
  }

  if (
    typeof arguments_.startLine === 'number' &&
    typeof arguments_.endLine === 'number' &&
    arguments_.endLine < arguments_.startLine
  ) {
    return invalid('endLine must be greater than or equal to startLine.');
  }

  return {
    path: arguments_.path,
    startLine: arguments_.startLine as number | undefined,
    endLine: arguments_.endLine as number | undefined,
  };
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
        path: { type: 'string', description: 'Project-relative file path.' },
        startLine: { type: 'integer', minimum: 1 },
        endLine: { type: 'integer', minimum: 1 },
      },
    },
    async execute(
      value: unknown,
      signal: AbortSignal = new AbortController().signal,
    ): Promise<ToolExecutionResult> {
      signal.throwIfAborted();
      const parsed = parseArguments(value);
      if ('ok' in parsed) return parsed;

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
