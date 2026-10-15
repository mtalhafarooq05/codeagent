import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-smoke-build-"));
const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-smoke-repo-"));
const task = "add a function to dummy.ts that takes two characters and concatenates them and prints";
const emptyFixture = process.argv.includes("--empty");

function run(command, args, cwd, timeout = 30_000) {
    return spawnSync(command, args, { cwd, encoding: "utf-8", timeout, stdio: "pipe" });
}

try {
    await fs.writeFile(path.join(buildRoot, "package.json"), JSON.stringify({ type: "module" }));
    await fs.mkdir(path.join(fixtureRoot, "test"));
    await fs.writeFile(
        path.join(fixtureRoot, "test", "dummy.ts"),
        emptyFixture ? "" : "export function existingFunction(): string {\n    return \"preserve me\";\n}\n"
    );
    await fs.writeFile(
        path.join(fixtureRoot, "package.json"),
        JSON.stringify({ name: "codepilot-smoke-fixture", type: "module", scripts: { test: "node --test" } }, null, 2)
    );

    const gitInit = run("git", ["init"], fixtureRoot);
    if (gitInit.status !== 0) throw new Error(gitInit.stderr || "Could not initialize smoke-test Git repository.");

    const compilerPath = path.join(projectRoot, "node_modules", "typescript", "lib", "tsc.js");
    const compilation = run(process.execPath, [
        compilerPath,
        "--project", path.join(projectRoot, "tsconfig.json"),
        "--outDir", buildRoot,
        "--noEmit", "false",
        "--declaration", "false",
        "--declarationMap", "false",
        "--sourceMap", "false"
    ], projectRoot);
    if (compilation.status !== 0) throw new Error(compilation.stdout + compilation.stderr);

    const agent = run(
        process.execPath,
        [path.join(buildRoot, "src", "index.js"), fixtureRoot, task],
        projectRoot,
        180_000
    );
    process.stdout.write(agent.stdout || "");
    process.stderr.write(agent.stderr || "");
    if (agent.error) throw agent.error;

    const result = await fs.readFile(path.join(fixtureRoot, "test", "dummy.ts"), "utf-8");
    const preservedExistingContent = emptyFixture
        ? true
        : result.includes("existingFunction") && result.includes("preserve me");
    const addedConcatenation = /function\s+\w+\s*\([^)]*\)[\s\S]*\+/.test(result);
    const addedPrint = /console\.log\s*\(/.test(result);

    if (!preservedExistingContent || !addedConcatenation || !addedPrint) {
        throw new Error(`Smoke test failed. Final fixture content:\n${result}`);
    }
    const fixtureDescription = emptyFixture ? "recognized the existing empty file" : "preserved its existing content";
    console.log(`\nSmoke test passed: Qwen located test/dummy.ts, ${fixtureDescription}, added concatenation, and added printing.`);
} finally {
    await fs.rm(buildRoot, { recursive: true, force: true });
    await fs.rm(fixtureRoot, { recursive: true, force: true });
}
