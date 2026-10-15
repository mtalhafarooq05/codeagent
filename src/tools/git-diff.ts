import { execFile } from "child_process";
import { promisify } from "util";
import { type Tool } from "./registry.js";
import { resolveSafePath } from "../utils/path-security.js";
import { createToolContext, repositoryRelativePath, type ToolContext } from "./context.js";

const execFileAsync = promisify(execFile);
const MAX_DIFF_LENGTH = 20_000;

async function runGit(repoRoot: string, args: string[], allowDiffExit = false): Promise<string> {
    try {
        const { stdout } = await execFileAsync("git", args, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 5 });
        return stdout;
    } catch (error: any) {
        if (allowDiffExit && error.code === 1 && typeof error.stdout === "string") {
            return error.stdout;
        }
        throw error;
    }
}

/**
 * A Tool object that retrieves the git diff of the repository or a specific file.
 */
export function createGitDiffTool(context: ToolContext): Tool {
    return {
    name: "git_diff",
    schema: {
        type: "function",
        function: {
            name: "git_diff",
            description: "Retrieves the git diff to inspect changes made to the repository. Useful for verifying file modifications.",
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "Optional relative path to a specific file to diff. If omitted, returns the diff for the entire repository."
                    }
                },
                required: []
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        const repoRoot = context.repoRoot;
        let requestedPath: string | undefined;
        if (args.filePath) {
            try {
                const safePath = resolveSafePath(repoRoot, args.filePath);
                requestedPath = repositoryRelativePath(context, safePath);
            } catch (error: any) {
                return error.message;
            }
        }

        try {
            const paths = requestedPath
                ? [requestedPath]
                : Array.from(context.state.changedFiles).sort();
            const diffParts: string[] = [];
            let status = "";

            if (paths.length > 0) {
                status = await runGit(repoRoot, ["status", "--short", "--untracked-files=all", "--", ...paths]);
                for (const filePath of paths) {
                    let fileDiff = await runGit(repoRoot, ["diff", "--no-color", "--", filePath]);
                    if (!fileDiff.trim()) {
                        try {
                            fileDiff = await runGit(repoRoot, ["diff", "--no-index", "--no-color", "--", "/dev/null", filePath], true);
                        } catch {
                            // The status line still reports an untracked file if this Git build cannot diff /dev/null.
                        }
                    }
                    if (fileDiff.trim()) diffParts.push(fileDiff.trimEnd());
                }
            } else {
                status = await runGit(repoRoot, ["status", "--short", "--untracked-files=all"]);
            }

            const combinedDiff = diffParts.join("\n\n");
            const displayedDiff = combinedDiff.length > MAX_DIFF_LENGTH
                ? `${combinedDiff.slice(0, MAX_DIFF_LENGTH)}\n\n... diff truncated at ${MAX_DIFF_LENGTH} characters ...`
                : combinedDiff;

            context.state.diffReviewed = !requestedPath || context.state.changedFiles.size <= 1;

            if (!status.trim() && !displayedDiff.trim()) {
                return "## Git changes\n\nNo changes detected for the requested scope.";
            }

            const statusSection = status.trim()
                ? `## Changed files\n\n${status.trim().split(/\r?\n/).map(line => `- \`${line}\``).join("\n")}`
                : "## Changed files\n\nNo status entries.";
            const diffSection = displayedDiff.trim()
                ? `## Unified diff\n\n\`\`\`diff\n${displayedDiff.trim()}\n\`\`\``
                : "## Unified diff\n\nNo tracked-content diff was produced.";
            return `${statusSection}\n\n${diffSection}`;
        } catch (error: any) {
            // This catches errors like git not being installed, or not being in a git repository
            return `Error executing git diff: ${error.message}\nNote: If this is not a git repository, git diff will not work. Stop trying to use the git_diff tool.`;
        }
    }
    };
}

export const gitDiffTool: Tool = createGitDiffTool(createToolContext("."));
