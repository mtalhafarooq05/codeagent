import fs from "fs/promises";
import path from "path";
import { type Tool } from "./registry.js";
import { createToolContext, type ToolContext } from "./context.js";

/**
 * A Tool object that recursively searches the repository for a specific file name,
 * returning all matching relative paths. Ignores common build/git directories.
 */
export function createFindPathTool(context: ToolContext): Tool {
    return {
    name: "find_path",
    schema: {
        type: "function",
        function: {
            name: "find_path",
            description: "Searches the repository for a file by its exact name (e.g. 'dummy.ts') and returns all matching relative paths. Use this to locate a file before modifying it.",
            parameters: {
                type: "object",
                properties: {
                    fileName: {
                        type: "string",
                        description: "The exact name of the file to search for, including extension."
                    }
                },
                required: ["fileName"]
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        const repoRoot = context.repoRoot;
        const fileName = args.fileName;

        if (!fileName) {
            return "Error: fileName argument is required.";
        }

        const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "out", ".agents"]);
        const matches: string[] = [];

        async function walk(dir: string) {
            try {
                const entries = await fs.readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        if (!IGNORED_DIRS.has(entry.name)) {
                            await walk(path.join(dir, entry.name));
                        }
                    } else if (entry.isFile()) {
                        if (entry.name.toLocaleLowerCase() === String(fileName).toLocaleLowerCase()) {
                            const relativePath = path.relative(repoRoot, path.join(dir, entry.name));
                            // Ensure forward slashes for output consistency
                            matches.push(relativePath.split(path.sep).join('/'));
                        }
                    }
                }
            } catch (err) {
                // Ignore permissions/access errors during walk
            }
        }

        await walk(repoRoot);

        if (matches.length === 0) {
            return `No files named '${fileName}' found in the repository.`;
        }

        matches.sort();
        const nextStep = matches.length === 1
            ? `\nNext step: call read_file with filePath '${matches[0]}' before attempting an edit.`
            : "\nNext step: inspect the relevant candidate with read_file before attempting an edit.";
        return `Found ${matches.length} matching file(s):\n${matches.map(m => `- ${m}`).join("\n")}${nextStep}`;
    }
    };
}

export const findPathTool: Tool = createFindPathTool(createToolContext("."));
