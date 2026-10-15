import fs from "fs/promises";
import path from "path";
import { type Tool } from "./registry.js";
import { resolveSafePath } from "../utils/path-security.js";
import { createToolContext, recordRead, repositoryRelativePath, type ToolContext } from "./context.js";

/**
 * A Tool object that reads the content of a file within the repository.
 */
export function createReadFileTool(context: ToolContext): Tool {
    return {
    name: "read_file",
    schema: {
        type: "function",
        function: {
            name: "read_file",
            description: "Reads the text contents of a file at the specified path.",
            parameters: {
                type: "object",
                properties: {
                    filePath: {
                        type: "string",
                        description: "Relative path to the file to read"
                    }
                },
                required: ["filePath"]
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        const relativePath = args.filePath;

        if (!relativePath) {
            return "Error: filePath argument is required.";
        }

        try {
            const safePath = resolveSafePath(context.repoRoot, relativePath);


            // Check if the target is actually a file (not a directory)
            const stats = await fs.stat(safePath);
            if (stats.isDirectory()) {
                return `Error: Path '${relativePath}' is a directory, not a file.`;
            }

            // Read file contents as UTF-8
            const content = await fs.readFile(safePath, "utf-8");
            const canonicalPath = repositoryRelativePath(context, safePath);
            recordRead(context, canonicalPath, content);
            if (content.length === 0) {
                return `File '${canonicalPath}' exists and was read successfully. It is empty (0 bytes). Use append_file to add requested code to this existing file.`;
            }
            return content;

        } catch (error: any) {
            if (error.code === "ENOENT") {
                return `Error: File '${relativePath}' not found.`;
            }
            return `Error reading file '${relativePath}': ${error.message}`;
        }
    }
    };
}

export const readFileTool: Tool = createReadFileTool(createToolContext("."));
