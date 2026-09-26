import { access, lstat, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative } from 'node:path';
import { IGNORED_PROJECT_DIRECTORIES } from './ignored-directories.js';

const MAX_DEPTH = 3;
const MAX_ENTRIES = 120;

export interface ProjectProfile {
  root: string;
  displayName: string;
  packageManager: string;
  moduleType: string;
  scripts: Record<string, string>;
  dependencyCount: number;
  devDependencyCount: number;
  hasTypeScript: boolean;
  workspace: boolean;
  tree: string[];
  treeTruncated: boolean;
}

interface PackageJson {
  name?: unknown;
  type?: unknown;
  packageManager?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  devDependencies?: unknown;
  workspaces?: unknown;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(root: string): Promise<PackageJson | undefined> {
  const path = join(root, 'package.json');
  if (!(await exists(path))) return undefined;

  try {
    const details = await lstat(path);
    if (!details.isFile() || details.isSymbolicLink()) {
      throw new Error('package.json must be a regular file inside the project.');
    }
    if (details.size > 1024 * 1024) {
      throw new Error('package.json is too large to inspect safely (limit: 1 MiB).');
    }
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('package.json must contain an object.');
    }
    return parsed as PackageJson;
  } catch (error) {
    throw new Error(`Unable to read package.json: ${String(error)}`, { cause: error });
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

async function detectPackageManager(root: string, packageJson?: PackageJson): Promise<string> {
  const declared = packageJson?.packageManager;
  if (typeof declared === 'string' && declared.trim()) return declared.trim();

  const lockfiles: ReadonlyArray<readonly [string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm'],
    ['npm-shrinkwrap.json', 'npm'],
  ];

  for (const [file, manager] of lockfiles) {
    if (await exists(join(root, file))) return manager;
  }
  return 'unknown';
}

async function collectTree(root: string): Promise<{ tree: string[]; truncated: boolean }> {
  const tree: string[] = [];
  let truncated = false;

  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || truncated) return;
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    for (const entry of entries) {
      if (tree.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      if (
        entry.isDirectory() &&
        IGNORED_PROJECT_DIRECTORIES.has(entry.name.toLowerCase())
      ) {
        continue;
      }
      if (entry.isSymbolicLink()) continue;

      const path = join(directory, entry.name);
      const shown = relative(root, path).replaceAll('\\', '/');
      tree.push(entry.isDirectory() ? `${shown}/` : shown);

      if (entry.isDirectory()) await visit(path, depth + 1);
    }
  }

  await visit(root, 0);
  return { tree, truncated };
}

export async function inspectProject(projectPath: string): Promise<ProjectProfile> {
  const root = await realpath(projectPath);
  const details = await stat(root);
  if (!details.isDirectory()) throw new Error(`Not a directory: ${projectPath}`);

  const packageJson = await readPackageJson(root);
  const scripts = stringRecord(packageJson?.scripts);
  const { tree, truncated } = await collectTree(root);
  const hasTypeScript =
    (await exists(join(root, 'tsconfig.json'))) ||
    tree.some((entry) => ['.ts', '.tsx', '.mts', '.cts'].includes(extname(entry)));

  return {
    root,
    displayName:
      typeof packageJson?.name === 'string' ? packageJson.name : basename(root),
    packageManager: await detectPackageManager(root, packageJson),
    moduleType:
      packageJson?.type === 'module'
        ? 'ES modules'
        : packageJson?.type === 'commonjs'
          ? 'CommonJS'
          : 'not declared',
    scripts,
    dependencyCount: Object.keys(stringRecord(packageJson?.dependencies)).length,
    devDependencyCount: Object.keys(stringRecord(packageJson?.devDependencies)).length,
    hasTypeScript,
    workspace:
      packageJson?.workspaces !== undefined ||
      (await exists(join(root, 'pnpm-workspace.yaml'))),
    tree,
    treeTruncated: truncated,
  };
}

export function formatProfile(profile: ProjectProfile): string {
  const safe = (value: string, limit = 160): string =>
    value.replace(/[\u0000-\u001f\u007f\u009b]/g, ' ').slice(0, limit);
  const scripts = Object.entries(profile.scripts);
  const scriptLines = scripts.slice(0, 25).map(
    ([name, command]) => `  ${safe(name, 80)}: ${safe(command)}`,
  );

  return [
    `Project: ${safe(profile.displayName)}`,
    `Root: ${safe(profile.root, 500)}`,
    `Package manager: ${safe(profile.packageManager)}`,
    `Module style: ${profile.moduleType}`,
    `TypeScript: ${profile.hasTypeScript ? 'yes' : 'not detected'}`,
    `Workspace: ${profile.workspace ? 'yes' : 'not detected'}`,
    `Dependencies: ${profile.dependencyCount} runtime, ${profile.devDependencyCount} development`,
    `Scripts (${scripts.length}${scripts.length > scriptLines.length ? ', showing first 25' : ''}):`,
    ...(scriptLines.length ? scriptLines : ['  none detected']),
    `File tree (first ${profile.tree.length} entries, depth ${MAX_DEPTH}${profile.treeTruncated ? ', truncated' : ''}):`,
    ...(profile.tree.length ? profile.tree.map((entry) => `  ${safe(entry, 500)}`) : ['  empty']),
  ].join('\n');
}
