import path from "path";

/**
 * Resolves a target path against a base directory and ensures the resulting path
 * does not escape the base directory (preventing directory traversal attacks).
 * 
 * @param baseDir The absolute path of the allowed base directory.
 * @param targetPath The relative or absolute path requested by the user/agent.
 * @returns The resolved, absolute safe path.
 * @throws Error if the path resolves outside the base directory.
 */
export function resolveSafePath(baseDir: string, targetPath: string): string {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(resolvedBase, targetPath);
    const relative = path.relative(resolvedBase, resolvedTarget);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error(`Access denied. Path '${targetPath}' is outside the repository boundary.`);
    }

    return resolvedTarget;
}
