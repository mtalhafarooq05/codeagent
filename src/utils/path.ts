import { lstat, open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isOutside(root: string, target: string): boolean {
  const fromRoot = relative(root, target);
  return fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

export class PathPolicyError extends Error {}

export interface OpenProjectFile {
  handle: FileHandle;
  root: string;
  target: string;
}

export async function resolveProjectPath(
  projectRoot: string,
  requestedPath: string,
): Promise<string> {
  if (isAbsolute(requestedPath)) {
    throw new PathPolicyError('Expected a project-relative path.');
  }

  const root = await realpath(projectRoot);
  const candidate = resolve(root, requestedPath);
  if (isOutside(root, candidate)) {
    throw new PathPolicyError('Requested path is outside the project.');
  }

  let current = root;
  for (const segment of relative(root, candidate).split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    if ((await lstat(current)).isSymbolicLink()) {
      throw new PathPolicyError('Paths containing symbolic links are not allowed.');
    }
  }

  const target = await realpath(candidate);
  if (isOutside(root, target)) {
    throw new PathPolicyError('Requested path resolves outside the project.');
  }

  return target;
}

export async function openProjectFile(
  projectRoot: string,
  requestedPath: string,
  signal: AbortSignal = new AbortController().signal,
): Promise<OpenProjectFile> {
  const target = await resolveProjectPath(projectRoot, requestedPath);
  signal.throwIfAborted();
  const handle = await open(target, 'r');

  try {
    const [root, revalidatedTarget, openedDetails] = await Promise.all([
      realpath(projectRoot),
      resolveProjectPath(projectRoot, requestedPath),
      handle.stat(),
    ]);
    const currentDetails = await stat(revalidatedTarget);
    signal.throwIfAborted();

    const samePath = target === revalidatedTarget;
    const sameFile =
      openedDetails.dev === currentDetails.dev &&
      openedDetails.ino === currentDetails.ino;
    if (!samePath || !sameFile) {
      throw new PathPolicyError('Requested path changed while it was being opened.');
    }

    return { handle, root, target };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
