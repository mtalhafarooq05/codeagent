import crypto from "crypto";
import path from "path";

export interface AgentSessionState {
    mutationExpected: boolean;
    readVersions: Map<string, string>;
    changedFiles: Set<string>;
    diffReviewed: boolean;
    verificationRun: boolean;
    verificationPassed?: boolean | undefined;
    verificationCommand?: string | undefined;
    recommendedVerificationCommand?: string | undefined;
}

export interface ToolContext {
    repoRoot: string;
    state: AgentSessionState;
    fileCreationAllowed: boolean;
}

export function createToolContext(
    repoRoot: string,
    fileCreationAllowed = true,
    mutationExpected = false,
    recommendedVerificationCommand?: string
): ToolContext {
    return {
        repoRoot: path.resolve(repoRoot),
        fileCreationAllowed,
        state: {
            mutationExpected,
            recommendedVerificationCommand,
            readVersions: new Map(),
            changedFiles: new Set(),
            diffReviewed: false,
            verificationRun: false
        }
    };
}

export function repositoryRelativePath(context: ToolContext, absolutePath: string): string {
    return path.relative(context.repoRoot, absolutePath).split(path.sep).join("/");
}

export function contentHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

export function recordRead(context: ToolContext, relativePath: string, content: string): void {
    context.state.readVersions.set(relativePath, contentHash(content));
}

export function recordMutation(context: ToolContext, relativePath: string, content: string): void {
    context.state.changedFiles.add(relativePath);
    context.state.readVersions.set(relativePath, contentHash(content));
    context.state.diffReviewed = false;
    context.state.verificationRun = false;
    context.state.verificationPassed = undefined;
    context.state.verificationCommand = undefined;
}
