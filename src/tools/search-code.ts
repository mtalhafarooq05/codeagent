import fs from "fs/promises";
import path from "path";
import { type Tool } from "./registry.js";
import { IGNORED_DIRECTORIES } from "../config.js";
import { resolveSafePath } from "../utils/path-security.js";
import { createToolContext, repositoryRelativePath, type ToolContext } from "./context.js";

const MAX_MATCHES = 100;

/**
 * A Tool object that searches the contents of files within the repository for a given query.
 */
export function createSearchCodeTool(context: ToolContext): Tool {
    return {
    name: "search_code",
    schema: {
        type: "function",
        function: {
            name: "search_code",
            description: "Searches the INSIDE CONTENTS of files in the repository for a text pattern. Do NOT use this to find files by their file name! To find a file by name, use the find_path tool.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "The text pattern to search for"
                    },
                    dirPath: {
                        type: "string",
                        description: "Optional relative directory path to search within. Defaults to the repository root."
                    }
                },
                required: ["query"]
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        const query = args.query;

        if (!query) {
            return "Error: query argument is required.";
        }
        if (/^[^/\\\s]+\.[A-Za-z0-9]+$/.test(String(query))) {
            return `Error: '${query}' looks like a filename. Use find_path to locate filenames; search_code is only for text inside files.`;
        }
        
        let searchRoot: string;
        try {
            searchRoot = resolveSafePath(context.repoRoot, args.dirPath || ".");
        } catch (error: any) {
            return error.message;
        }

        const matches: string[] = [];

        async function searchDirectory(dirPath: string) {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (matches.length >= MAX_MATCHES) {
                    return;
                }
                if (entry.isDirectory()) {
                    if (IGNORED_DIRECTORIES.has(entry.name)) {
                        continue;
                    }
                    const fullPath = path.join(dirPath, entry.name);
                    await searchDirectory(fullPath);
                } else if (entry.isFile()) {
                    const fullPath = path.join(dirPath, entry.name);
                    try {
                        const content = await fs.readFile(fullPath, "utf-8");
                        const lines = content.split('\n');
                        lines.forEach((line: string, i: number) => {
                            if (line.includes(query)) {
                                if (matches.length < MAX_MATCHES) {
                                    const relativePath = repositoryRelativePath(context, fullPath);
                                    matches.push(`${relativePath}:${i + 1} - ${line.trim()}`);
                                }
                            }
                        });
                    } catch (error) {
                        // Skip files that can't be read as utf-8 (e.g. binary files)
                    }
                }
            }
        }

        try {
            await searchDirectory(searchRoot);
            
            if (matches.length === 0) {
                return `No matches found for '${query}'.`;
            }
            
            const suffix = matches.length === MAX_MATCHES
                ? `\nResults were limited to ${MAX_MATCHES} matches. Narrow the query or dirPath for more precision.`
                : "";
            return `Found ${matches.length} matches:\n${matches.join('\n')}${suffix}`;
        } catch (error: any) {
            return `Error searching code: ${error.message}`;
        }
    }
    };
}

export const searchCodeTool: Tool = createSearchCodeTool(createToolContext("."));
