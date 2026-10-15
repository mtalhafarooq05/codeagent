import fs from "fs/promises";
import path from "path";
import { inspectDirectory } from "./fs-inspector.js";
import { analyzeLanguages } from "./language-analyzer.js";
import { inspectGit } from "./git-inspector.js";
import { type AIProvider } from "./ai/provider.js";
import { OllamaProvider } from "./ai/ollama-provider.js";
import { buildPrompt } from "./prompt-builder.js";
import { ToolRegistry } from "./tools/registry.js";
import { createReadFileTool } from "./tools/read-file.js";
import { createSearchCodeTool } from "./tools/search-code.js";
import { createCreateFileTool } from "./tools/write-file.js";
import { createEditFileTool } from "./tools/edit-file.js";
import { createAppendFileTool } from "./tools/append-file.js";
import { createGitDiffTool } from "./tools/git-diff.js";
import { createRunCommandTool } from "./tools/run-command.js";
import { createFindPathTool } from "./tools/find-path.js";
import { inspectProjectCapabilities } from "./project-inspector.js";
import { createToolContext } from "./tools/context.js";

function countFiles(nodes: Awaited<ReturnType<typeof inspectDirectory>>): number {
    return nodes.reduce((total, node) => {
        if (node.type === "file") return total + 1;
        return total + countFiles(node.children || []);
    }, 0);
}

function explicitlyRequestsNewFiles(task: string): boolean {
    return /\b(create|generate|make)\b[^.!?\n]{0,80}\b(file|test|module|component)\b/i.test(task)
        || /\badd\b[^.!?\n]{0,40}\b(new\s+)?(file|test|module|component)\b/i.test(task)
        || /\bnew\s+(file|test|module|component)\b/i.test(task);
}

function requestsRepositoryChanges(task: string): boolean {
    return /\b(add|change|create|delete|fix|generate|implement|make|modify|move|refactor|remove|rename|replace|update|write)\b/i.test(task);
}

async function detectVerificationCommand(repoPath: string): Promise<string | undefined> {
    try {
        const packageContent = await fs.readFile(path.join(repoPath, "package.json"), "utf-8");
        const packageJson = JSON.parse(packageContent);
        const scripts = packageJson.scripts || {};
        for (const name of ["test", "typecheck", "lint", "build"]) {
            const script = scripts[name];
            if (typeof script !== "string") continue;
            if (name === "test" && /no test specified/i.test(script)) continue;
            return `npm run ${name}`;
        }
    } catch {
        // A missing or malformed package.json simply means no automatic command was detected.
    }
    return undefined;
}

async function main() {
    // process.argv contains the command line arguments.
    // Index 0 is the Node executable path.
    // Index 1 is the path to this script (index.ts).
    // Index 2 is the first actual argument (the repository path).
    // Index 3 is the second actual argument (the task description).
    const repoPath = path.resolve(process.argv[2] ?? ".");
    const taskDescription = process.argv.slice(3).join(" ").trim()
        || "Analyze this repository and summarize what you see.";

    console.log(`CodePilot starting...`);
    console.log(`Repository: ${repoPath}`);
    console.log(`Task:       ${taskDescription}`);

    try {
        // Wait for the hard drive to check the path
        const stats = await fs.stat(repoPath);

        // Check if it's actually a directory
        if (!stats.isDirectory()) {
            console.error(`Error: The path '${repoPath}' is not a directory.`);
            process.exit(1); // Exit the program with an error code
        }

        console.log("Path successfully validated as a directory.");

    } catch (error) {
        // If fs.stat throws an error, it usually means the path doesn't exist
        console.error(`Error: The path '${repoPath}' does not exist.`);
        process.exit(1);
    }

    console.log("\nInspecting Git repository...");
    const gitInfo = await inspectGit(repoPath);

    // Now that we know the directory is valid, let's inspect it!
    console.log("Inspecting file system...");
    const structure = await inspectDirectory(repoPath);

    console.log("Analyzing languages...");
    const languageCounts = analyzeLanguages(structure);

    console.log("\n--- Repository Summary ---");
    console.log(`Files discovered: ${countFiles(structure)}`);
    console.log(`Git branch: ${gitInfo.isGitRepo ? gitInfo.branch || "detached" : "not a Git repository"}`);
    console.log(`Existing uncommitted changes: ${gitInfo.hasUncommittedChanges ? "yes" : "no"}`);
    console.log(`Languages: ${Object.entries(languageCounts).map(([language, count]) => `${language} (${count})`).join(", ") || "none detected"}`);

    console.log("Inspecting project capabilities...");
    const capabilities = await inspectProjectCapabilities(repoPath);
    const verificationCommand = await detectVerificationCommand(repoPath);

    // Send the task and repository context to the AI Provider
    console.log("\n--- AI Provider ---");
    console.log("Constructing prompt with repository context...");

    const messages = buildPrompt(taskDescription, { capabilities, structure, gitInfo });

    console.log("Sending context and task to AI model...");

    // Setup the tool registry
    const registry = new ToolRegistry();
    const toolContext = createToolContext(
        repoPath,
        explicitlyRequestsNewFiles(taskDescription),
        requestsRepositoryChanges(taskDescription),
        verificationCommand
    );
    registry.registerTool(createFindPathTool(toolContext));
    registry.registerTool(createReadFileTool(toolContext));
    registry.registerTool(createSearchCodeTool(toolContext));
    registry.registerTool(createAppendFileTool(toolContext));
    registry.registerTool(createEditFileTool(toolContext));
    registry.registerTool(createCreateFileTool(toolContext));
    registry.registerTool(createGitDiffTool(toolContext));
    registry.registerTool(createRunCommandTool(toolContext));

    const ai: AIProvider = new OllamaProvider("qwen2.5-coder", "http://localhost:11434", registry, toolContext.state);
    
    try {
        const response = await ai.generateResponse(messages);
        console.log("\n--- AI Response ---");
        console.log(response);
    } catch (error: any) {
        console.error(`\nAI Error: ${error.message}`);
    }
}

main();
