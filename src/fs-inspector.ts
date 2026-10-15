import fs from "fs/promises";
import path from "path";

// Define what our file structure data will look like
export interface FileNode {
    name: string;
    type: "file" | "directory";
    children?: FileNode[]; // Only directories will have children
}

import { IGNORED_DIRECTORIES } from "./config.js";
/**
 * Recursively reads a directory and returns its structure.
 * @param dirPath The path to inspect
 * @returns An array of FileNode objects representing files and folders
 */
export async function inspectDirectory(dirPath: string): Promise<FileNode[]> {
    const nodes: FileNode[] = [];
    
    // Read the directory contents. 
    // withFileTypes: true returns 'fs.Dirent' objects. This is a massive performance boost 
    // because it tells us if an item is a file or a folder immediately, 
    // saving us from having to run fs.stat() on every single file.
    const entries = await fs.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
        if (entry.isDirectory()) {
            // Skip folders we don't care about (like node_modules)
            if (IGNORED_DIRECTORIES.has(entry.name)) {
                continue;
            }
            
            // Construct the absolute path to this subdirectory
            const fullPath = path.join(dirPath, entry.name);
            
            // RECURSION: We call this exact same function on the subdirectory
            // to get its children, and wait for it to finish.
            const children = await inspectDirectory(fullPath);
            
            nodes.push({
                name: entry.name,
                type: "directory",
                children
            });
        } else if (entry.isFile()) {
            nodes.push({
                name: entry.name,
                type: "file"
            });
        }
    }

    return nodes;
}
