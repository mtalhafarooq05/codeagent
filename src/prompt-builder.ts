import { type Message } from "./ai/provider.js";
import { type FileNode } from "./fs-inspector.js";
import { type GitInfo } from "./git-inspector.js";

export interface PromptContext {
    capabilities: string;
    structure: FileNode[];
    gitInfo: GitInfo;
}

const MAX_STRUCTURE_PATHS = 600;

function flattenStructure(nodes: FileNode[], parent = "", output: string[] = []): string[] {
    for (const node of nodes) {
        if (output.length >= MAX_STRUCTURE_PATHS) break;
        const currentPath = parent ? `${parent}/${node.name}` : node.name;
        if (node.type === "file") {
            output.push(currentPath);
        } else if (node.children) {
            flattenStructure(node.children, currentPath, output);
        }
    }
    return output;
}

export function buildPrompt(userContent: string, context: PromptContext): Message[] {
    const paths = flattenStructure(context.structure);
    const structureNote = paths.length >= MAX_STRUCTURE_PATHS
        ? `\n- ... listing limited to ${MAX_STRUCTURE_PATHS} files; use find_path for exact filename lookup.`
        : "";
    const gitSummary = context.gitInfo.isGitRepo
        ? `Git repository: yes\nBranch: ${context.gitInfo.branch || "detached"}\nUncommitted changes present: ${context.gitInfo.hasUncommittedChanges ? "yes" : "no"}`
        : "Git repository: no";

    const systemMessage: Message = {
        role: "system",
        content: `You are CodePilot, a software-engineering agent operating on a real local repository through tools.

Repository evidence and tool results are authoritative. Never invent paths, symbols, dependencies, commands, or verification results.

Required workflow:
1. Locate exact paths from the repository manifest. If only a filename is known, call find_path. Never use search_code to find a filename.
2. Call read_file on every existing file before editing it.
3. When adding a new function or code at the end, use append_file after read_file; it preserves the entire existing file. Use edit_file only when existing text must change.
4. Use create_file only when the user explicitly requests a new file. Never create a guessed replacement for an existing file.
5. After changes, call git_diff and inspect its result. Run the most relevant existing verification command with run_command.
6. If a tool reports an error, correct the tool arguments from repository evidence; do not pretend the operation succeeded.

Editing rules:
- Make the smallest relevant change and preserve unrelated code, formatting, exports, and behavior.
- Copy oldText exactly from the latest read_file result and include enough context for one unique match.
- For append_file, send only the new code in content; never repeat the old file content.
- Never replace or erase an entire existing file to add a function.
- Do not add packages, imports, files, or APIs unless repository evidence or the task requires them.

Tool protocol:
- Use native tool calls. Never print tool-call JSON, XML, or fenced JSON to the user.
- search_code searches file contents only; find_path locates filenames.
- Do not repeatedly invoke a failed tool without changing the arguments or gathering new evidence.

Final response:
- Write concise Markdown, never raw JSON.
- State what changed, list exact repository-relative paths, report the command actually run and whether it passed, and mention unresolved failures.
- Never claim success unless the tool results support it.`
    };

    const userMessage: Message = {
        role: "user",
        content: `# Task

${userContent}

# Repository facts

${gitSummary}

${context.capabilities}

## Repository file manifest

${paths.map(filePath => `- ${filePath}`).join("\n")}${structureNote}`
    };

    return [systemMessage, userMessage];
}
