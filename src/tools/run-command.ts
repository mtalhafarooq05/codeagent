import { exec } from "child_process";
import path from "path";
import { type Tool } from "./registry.js";
import { resolveSafePath } from "../utils/path-security.js";
import { createToolContext, type ToolContext } from "./context.js";

const FORBIDDEN_COMMANDS = [
    "rm -rf", "del", "sudo", "curl", "wget", "format", 
    "mkfs", "dd", "chmod", "chown", "reboot", "shutdown",
    "npm install", "npm i ", "yarn add", "pnpm add", "pnpm i",
    "ts-node"
];

const MAX_OUTPUT_LENGTH = 4000;
const TIMEOUT_MS = 10000; // 10 seconds

export function createRunCommandTool(context: ToolContext): Tool {
    return {
    name: "run_command",
    schema: {
        type: "function",
        function: {
            name: "run_command",
            description: "Executes a shell command in the project directory. Use this to run builds, tests, linters, or other verification tools. You MUST read the output to determine if your code changes were successful.",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "The shell command to execute."
                    },
                    dirPath: {
                        type: "string",
                        description: "Optional relative directory path to execute the command within. Defaults to the repository root."
                    }
                },
                required: ["command"]
            }
        }
    },
    execute: async (args: any): Promise<string> => {
        const command = args.command as string;
        
        if (!command) {
            return "Error: command argument is required.";
        }

        // Basic Deny-list Check
        const lowerCommand = command.toLowerCase();
        for (const forbidden of FORBIDDEN_COMMANDS) {
            if (lowerCommand.includes(forbidden)) {
                return `Error: Command rejected by policy. You are not allowed to install packages or use destructive/network tools like '${forbidden}'. Check the Project Capabilities context for available existing tools.`;
            }
        }

        // Directory Security
        let execCwd: string;
        try {
            execCwd = resolveSafePath(context.repoRoot, args.dirPath || ".");
        } catch (error: any) {
            return error.message;
        }

        return new Promise((resolve) => {
            const child = exec(command, {
                cwd: execCwd,
                timeout: TIMEOUT_MS,
                maxBuffer: 1024 * 1024 * 10 // 10MB internal buffer limit before node throws
            }, (error: any, stdout: string, stderr: string) => {
                
                // Combine outputs as discussed
                let combinedOutput = "";
                if (stdout) combinedOutput += `[STDOUT]\n${stdout}\n`;
                if (stderr) combinedOutput += `[STDERR]\n${stderr}\n`;
                
                // If it timed out
                if (error && error.killed) {
                    combinedOutput += `\n[ERROR]: Command timed out after ${TIMEOUT_MS / 1000} seconds.`;
                } else if (error) {
                    combinedOutput += `\n[EXIT CODE]: ${error.code}`;
                } else {
                    combinedOutput += `\n[EXIT CODE]: 0 (Success)`;
                }

                context.state.verificationRun = true;
                context.state.verificationPassed = !error;
                context.state.verificationCommand = command;

                // Truncate output if it exceeds our limit
                if (combinedOutput.length > MAX_OUTPUT_LENGTH) {
                    const keepEachEnd = MAX_OUTPUT_LENGTH / 2 - 50; // Keep half at start, half at end, minus space for message
                    const start = combinedOutput.substring(0, keepEachEnd);
                    const end = combinedOutput.substring(combinedOutput.length - keepEachEnd);
                    combinedOutput = `${start}\n\n... [OUTPUT TRUNCATED DUE TO LENGTH] ...\n\n${end}`;
                }

                resolve(combinedOutput.trim());
            });
        });
    }
    };
}

export const runCommandTool: Tool = createRunCommandTool(createToolContext("."));
