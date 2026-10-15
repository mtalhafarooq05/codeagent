import fs from "fs/promises";
import path from "path";
import { type Tool } from "./registry.js";
import { resolveSafePath } from "../utils/path-security.js";
import { createToolContext, recordMutation, repositoryRelativePath, type ToolContext } from "./context.js";

/**
 * Creates a new file without ever overwriting an existing path.
 */
export function createCreateFileTool(context: ToolContext): Tool {
    return {
    name: "create_file",
    schema: {
        type: "function",
        function: {
            name: "create_file",
            description: "Creates a brand-new file. It never overwrites an existing file and refuses a duplicate filename elsewhere in the repository. Use edit_file for existing files.",
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "Relative path to the file to write"
                    },
                    content: {
                        type: "string",
                        description: "The complete new content to write to the file"
                    }
                },
                required: ["filePath", "content"]
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        if (!context.fileCreationAllowed) {
            return "Error: The user did not explicitly request a new file, so file creation is disabled for this task. Locate and edit the existing file instead.";
        }
        const repoRoot = context.repoRoot;
        const relativePath = args.filePath;
        const content = args.content;

        if (!relativePath) {
            return "Error: filePath argument is required.";
        }
        if (content === undefined) {
            return "Error: content argument is required.";
        }

        let safePath: string;
        try {
            safePath = resolveSafePath(repoRoot, relativePath);
        } catch (error: any) {
            return error.message;
        }

        try {
            let fileExists = true;
            try {
                const stats = await fs.stat(safePath);
                if (stats.isDirectory()) {
                    return `Error: Path '${relativePath}' is a directory. Cannot overwrite a directory.`;
                }
            } catch (err) {
                fileExists = false;
            }

            if (fileExists) {
                return `Error: File '${relativePath}' already exists. Read it and use edit_file instead.`;
            }

            const fileName = path.basename(safePath);
            const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "out", ".agents"]);
            const matches: string[] = [];

            async function walk(dir: string) {
                try {
                    const entries = await fs.readdir(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isDirectory() && !IGNORED_DIRS.has(entry.name)) {
                            await walk(path.join(dir, entry.name));
                        } else if (entry.isFile() && entry.name.toLocaleLowerCase() === fileName.toLocaleLowerCase()) {
                            matches.push(path.relative(repoRoot, path.join(dir, entry.name)).split(path.sep).join('/'));
                        }
                    }
                } catch (err) { }
            }
            await walk(repoRoot);

            if (matches.length > 0) {
                return `Error: A file named '${fileName}' already exists at:\n${matches.map(m => `- ${m}`).join("\n")}\nRead and edit the existing file unless the user explicitly requested another file with the same name.`;
            }

            // Ensure the directory exists
            const dirName = path.dirname(safePath);
            await fs.mkdir(dirName, { recursive: true });

            const handle = await fs.open(safePath, "wx");
            try {
                await handle.writeFile(content, "utf-8");
            } finally {
                await handle.close();
            }

            const canonicalPath = repositoryRelativePath(context, safePath);
            recordMutation(context, canonicalPath, content);
            return `Success: Created new file '${canonicalPath}'.`;
        } catch (error: any) {
            return `Error writing file '${relativePath}': ${error.message}`;
        }
    }
    };
}

export const createFileTool: Tool = createCreateFileTool(createToolContext("."));
export const writeFileTool: Tool = createFileTool;
