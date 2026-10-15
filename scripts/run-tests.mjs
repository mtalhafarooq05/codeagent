import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-test-build-"));

try {
    await fs.writeFile(path.join(outputRoot, "package.json"), JSON.stringify({ type: "module" }));

    const compilerPath = path.join(projectRoot, "node_modules", "typescript", "lib", "tsc.js");
    const compilation = spawnSync(process.execPath, [
        compilerPath,
        "--project", path.join(projectRoot, "tsconfig.json"),
        "--outDir", outputRoot,
        "--noEmit", "false",
        "--declaration", "false",
        "--declarationMap", "false",
        "--sourceMap", "false"
    ], { cwd: projectRoot, encoding: "utf-8", stdio: "inherit" });

    if (compilation.status !== 0) {
        process.exitCode = compilation.status ?? 1;
    } else {
        const testFile = path.join(outputRoot, "src", "tests", "sample.test.js");
        const tests = spawnSync(process.execPath, ["--test", testFile], {
            cwd: projectRoot,
            encoding: "utf-8",
            stdio: "inherit"
        });
        process.exitCode = tests.status ?? 1;
    }
} finally {
    await fs.rm(outputRoot, { recursive: true, force: true });
}
