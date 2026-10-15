import fs from "fs/promises";
import path from "path";

/**
 * Inspects the repository for package.json and tsconfig.json to extract
 * available scripts, dependencies, and configuration, preventing the AI
 * from hallucinating commands or installing unneeded packages.
 */
export async function inspectProjectCapabilities(repoPath: string): Promise<string> {
    let capabilities = "## Project Capabilities\n\n";

    // 1. Inspect package.json
    try {
        const pkgPath = path.join(repoPath, "package.json");
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);

        // Determine package manager (basic heuristic)
        let pm = "npm";
        try {
            await fs.stat(path.join(repoPath, "yarn.lock"));
            pm = "yarn";
        } catch { }
        try {
            await fs.stat(path.join(repoPath, "pnpm-lock.yaml"));
            pm = "pnpm";
        } catch { }

        capabilities += `**Package Manager**: ${pm}\n\n`;

        capabilities += `**Available Scripts** (run via \`${pm} run <script>\`):\n`;
        if (pkg.scripts && Object.keys(pkg.scripts).length > 0) {
            for (const [name, cmd] of Object.entries(pkg.scripts)) {
                capabilities += `- \`${name}\` -> \`${cmd}\`\n`;
            }
        } else {
            capabilities += `- None found.\n`;
        }
        capabilities += "\n";

        const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        capabilities += `**Installed Dev Tools & Dependencies**:\n`;
        const importantTools = ["typescript", "tsx", "ts-node", "jest", "vitest", "eslint", "prettier"];
        let foundTools = false;
        for (const tool of importantTools) {
            if (allDeps[tool]) {
                capabilities += `- \`${tool}\`\n`;
                foundTools = true;
            }
        }
        if (!foundTools) {
            capabilities += `- None of the common tools (typescript, tsx, jest, etc.) found in package.json.\n`;
        }
        capabilities += "\n";

    } catch (error) {
        capabilities += "**package.json**: Not found or unreadable.\n\n";
    }

    // 2. Inspect tsconfig.json
    try {
        const tsconfigPath = path.join(repoPath, "tsconfig.json");
        const tsconfigContent = await fs.readFile(tsconfigPath, "utf-8");
        const tsconfig = JSON.parse(tsconfigContent);
        
        capabilities += `**TypeScript Configuration (tsconfig.json)**:\n`;
        if (tsconfig.compilerOptions) {
            if (tsconfig.compilerOptions.noEmit) {
                capabilities += `- \`noEmit: true\` (tsc is only used for type-checking, not compiling files)\n`;
            }
            if (tsconfig.compilerOptions.module) {
                capabilities += `- \`module: ${tsconfig.compilerOptions.module}\`\n`;
            }
        } else {
            capabilities += `- Basic configuration found.\n`;
        }

    } catch (error) {
        capabilities += "**TypeScript Configuration**: No tsconfig.json found.\n";
    }

    return capabilities.trim();
}
