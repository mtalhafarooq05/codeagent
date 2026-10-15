import fs from "fs/promises";
import { resolveSafePath } from "../utils/path-security.js";
import { contentHash, createToolContext, recordMutation, repositoryRelativePath, type ToolContext } from "./context.js";
import { type Tool } from "./registry.js";

export function createAppendFileTool(context: ToolContext): Tool {
    return {
        name: "append_file",
        schema: {
            type: "function",
            function: {
                name: "append_file",
                description: "Appends a new function or other code to an existing file while preserving every existing character. Call read_file on the exact path first. Use this when adding code at the end of a file; use edit_file when existing code must change.",
                parameters: {
                    type: "object",
                    properties: {
                        filePath: {
                            type: "string",
                            description: "Exact repository-relative path of the existing file."
                        },
                        content: {
                            type: "string",
                            description: "Only the new code to append. Do not repeat the existing file content."
                        }
                    },
                    required: ["filePath", "content"]
                }
            }
        },
        execute: async (args: any): Promise<string> => {
            if (!args.filePath) return "Error: filePath argument is required.";
            if (typeof args.content !== "string" || !args.content.trim()) {
                return "Error: content must contain the new code to append.";
            }

            let safePath: string;
            try {
                safePath = resolveSafePath(context.repoRoot, args.filePath);
            } catch (error: any) {
                return error.message;
            }

            try {
                const stats = await fs.stat(safePath);
                if (!stats.isFile()) return `Error: Path '${args.filePath}' is not a file.`;

                const canonicalPath = repositoryRelativePath(context, safePath);
                const current = await fs.readFile(safePath, "utf-8");
                const readVersion = context.state.readVersions.get(canonicalPath);
                if (!readVersion) {
                    return `Error: '${canonicalPath}' has not been read in this session. Call read_file first.`;
                }
                if (readVersion !== contentHash(current)) {
                    return `Error: '${canonicalPath}' changed after it was read. Read it again before appending.`;
                }

                const separator = current.length === 0 ? "" : current.endsWith("\n") ? "\n" : "\n\n";
                const addition = args.content.replace(/^\s*\n/, "");
                const updated = `${current}${separator}${addition}`;
                const temporaryPath = `${safePath}.${process.pid}.${Date.now()}.tmp`;
                await fs.writeFile(temporaryPath, updated, "utf-8");
                await fs.rename(temporaryPath, safePath);

                recordMutation(context, canonicalPath, updated);
                return `Success: Appended new code to '${canonicalPath}'. All existing file content was preserved.`;
            } catch (error: any) {
                if (error.code === "ENOENT") {
                    return `Error: File '${args.filePath}' does not exist. Use find_path to locate it.`;
                }
                return `Error appending to file '${args.filePath}': ${error.message}`;
            }
        }
    };
}

export const appendFileTool: Tool = createAppendFileTool(createToolContext("."));
