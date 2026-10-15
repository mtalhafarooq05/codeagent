import { exec } from "child_process";
import { promisify } from "util";

// Convert the old callback-based exec function into a modern Promise-based one
const execAsync = promisify(exec);

export interface GitInfo {
    isGitRepo: boolean;
    branch?: string;
    hasUncommittedChanges?: boolean;
}

/**
 * Inspects a directory to determine Git status.
 * @param repoPath The directory to inspect
 * @returns GitInfo object
 */
export async function inspectGit(repoPath: string): Promise<GitInfo> {
    try {
        // 1. Is this a Git repository?
        // We pass { cwd: repoPath } so the command runs inside the target directory, not our current working directory.
        await execAsync("git rev-parse --is-inside-work-tree", { cwd: repoPath });

        // 2. What is the current branch?
        const branchResult = await execAsync("git branch --show-current", { cwd: repoPath });
        const branch = branchResult.stdout.trim();

        // 3. Are there uncommitted changes?
        // git status --porcelain prints an empty string if there are no changes, 
        // or a list of files if there are changes.
        const statusResult = await execAsync("git status --porcelain", { cwd: repoPath });
        const hasUncommittedChanges = statusResult.stdout.trim().length > 0;

        return {
            isGitRepo: true,
            branch,
            hasUncommittedChanges
        };

    } catch (error) {
        // If git rev-parse exits with an error code (e.g., exit code 128 "not a git repository"),
        // execAsync throws an error and we end up in the catch block.
        return {
            isGitRepo: false
        };
    }
}
