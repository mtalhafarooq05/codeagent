import { join, relative } from 'node:path';
import { IGNORED_PROJECT_DIRECTORIES } from '../project/ignored-directories.js';
import { openProjectDirectory, PathPolicyError } from '../utils/path.js';
import type { Tool } from './types.js';
const MAX_ENTRIES = 200;

interface ListedEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
}

function compareEntries(left: ListedEntry, right: ListedEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
}

function retainBestEntry(entries: ListedEntry[], entry: ListedEntry): void {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (compareEntries(entries[middle]!, entry) <= 0) low = middle + 1;
    else high = middle;
  }
  entries.splice(low, 0, entry);
  if (entries.length > MAX_ENTRIES) entries.pop();
}

export function createListDirectoryTool(projectRoot: string): Tool {
  return {
    name: 'list_directory',
    description: 'List files and directories immediately inside a project directory.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          minLength: 1,
          pattern: '\\S',
          description: 'Project-relative directory path. Defaults to the project root.',
        },
      },
    },
    async execute(
      arguments_: Record<string, unknown>,
      signal: AbortSignal = new AbortController().signal,
    ) {
      signal.throwIfAborted();
      const requestedPath = (arguments_.path as string | undefined) ?? '.';
      let opened: Awaited<ReturnType<typeof openProjectDirectory>>;
      try {
        opened = await openProjectDirectory(projectRoot, requestedPath, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return {
            ok: false,
            error: {
              code: 'DIRECTORY_NOT_FOUND',
              message: `Directory not found: ${requestedPath}.`,
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
        if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
          return {
            ok: false,
            error: {
              code: 'NOT_A_DIRECTORY',
              message: `Path is not a directory: ${requestedPath}.`,
            },
          };
        }
        throw error;
      }

      const entries: ListedEntry[] = [];
      let eligibleEntries = 0;
      let truncated = false;
      try {
        for await (const entry of opened.directory) {
          signal.throwIfAborted();
          if (
            entry.isSymbolicLink() ||
            (!entry.isFile() && !entry.isDirectory()) ||
            (entry.isDirectory() &&
              IGNORED_PROJECT_DIRECTORIES.has(entry.name.toLowerCase()))
          ) {
            continue;
          }

          eligibleEntries += 1;
          retainBestEntry(entries, {
            name: entry.name,
            path: relative(opened.root, join(opened.target, entry.name)).replaceAll(
              '\\',
              '/',
            ),
            type: entry.isDirectory() ? 'directory' : 'file',
          });
          truncated = eligibleEntries > MAX_ENTRIES;
        }
      } finally {
        await opened.directory.close().catch(() => undefined);
      }
      return {
        ok: true,
        value: {
          path:
            relative(opened.root, opened.target).replaceAll('\\', '/') || '.',
          entries,
          truncated,
        },
      };
    },
  };
}
