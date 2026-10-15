import fs from "fs/promises";
import { resolveSafePath } from "../utils/path-security.js";
import { contentHash, createToolContext, recordMutation, repositoryRelativePath, type ToolContext } from "./context.js";
import { type Tool } from "./registry.js";

function occurrenceCount(content: string, search: string): number {
    if (!search) return 0;
    let count = 0;
    let index = 0;
    while ((index = content.indexOf(search, index)) !== -1) {
        count++;
        index += search.length;
    }
    return count;
}

export function createEditFileTool(context: ToolContext): Tool {
    return {
        name: "edit_file",
        schema: {
            type: "function",
            function: {
                name: "edit_file",
                description: "Makes one focused edit to an existing file by replacing one exact text block. You must call read_file on the same path first. Unmatched, ambiguous, stale, or whole-file replacements are rejected.",
                parameters: {
                    type: "object",
                    properties: {
                        filePath: {
                            type: "string",
                            description: "Exact repository-relative path of the existing file."
                        },
                        oldText: {
                            type: "string",
                            description: "An exact, unique text block copied from the latest read_file result."
                        },
                        newText: {
                            type: "string",
                            description: "Replacement for oldText, including oldText where necessary to preserve it."
                        }
                    },
                    required: ["filePath", "oldText", "newText"]
                }
            }
        },
        execute: async (args: any): Promise<string> => {
            if (!args.filePath) return "Error: filePath argument is required.";
            if (typeof args.oldText !== "string" || !args.oldText) return "Error: oldText must be a non-empty string.";
            if (typeof args.newText !== "string") return "Error: newText argument is required.";

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
                    return `Error: '${canonicalPath}' has not been read in this session. Call read_file first, then make a focused edit.`;
                }
                if (readVersion !== contentHash(current)) {
                    return `Error: '${canonicalPath}' changed after it was read. Read it again before editing.`;
                }

                const matches = occurrenceCount(current, args.oldText);
                if (matches === 0) {
                    return "Error: oldText was not found exactly. Read the file again and copy a precise block from it.";
                }
                if (matches > 1) {
                    return `Error: oldText matched ${matches} locations. Include more surrounding text so the edit is unambiguous.`;
                }
                if (args.oldText === current) {
                    return "Error: Whole-file replacement is not allowed. Use a smaller exact block so unrelated content is preserved.";
                }

                const updated = current.replace(args.oldText, args.newText);
                if (current.trim() && !updated.trim()) {
                    return "Error: This edit would erase the file, so it was rejected.";
                }
                if (current.length > 200 && updated.length < current.length / 2) {
                    return "Error: This edit would remove more than half of the file. Split it into focused edits or ask the user to confirm a large deletion.";
                }

                const temporaryPath = `${safePath}.${process.pid}.${Date.now()}.tmp`;
                await fs.writeFile(temporaryPath, updated, "utf-8");
                await fs.rename(temporaryPath, safePath);

                recordMutation(context, canonicalPath, updated);
                const lineDelta = updated.split(/\r?\n/).length - current.split(/\r?\n/).length;
                const deltaLabel = lineDelta === 0 ? "no line-count change" : `${lineDelta > 0 ? "+" : ""}${lineDelta} lines`;
                return `Success: Applied one focused edit to '${canonicalPath}' (${deltaLabel}). Existing content outside the matched block was preserved.`;
            } catch (error: any) {
                if (error.code === "ENOENT") {
                    return `Error: File '${args.filePath}' does not exist. Use find_path before editing; use create_file only for an explicitly requested new file.`;
                }
                return `Error editing file '${args.filePath}': ${error.message}`;
            }
        }
    };
}

export const editFileTool: Tool = createEditFileTool(createToolContext("."));
