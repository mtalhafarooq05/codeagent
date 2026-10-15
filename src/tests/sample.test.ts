import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { OllamaProvider } from "../ai/ollama-provider.js";
import { createAppendFileTool } from "../tools/append-file.js";
import { createToolContext } from "../tools/context.js";
import { createCreateFileTool } from "../tools/write-file.js";
import { createEditFileTool } from "../tools/edit-file.js";
import { createFindPathTool } from "../tools/find-path.js";
import { createGitDiffTool } from "../tools/git-diff.js";
import { createReadFileTool } from "../tools/read-file.js";
import { createSearchCodeTool } from "../tools/search-code.js";
import { ToolRegistry } from "../tools/registry.js";

const execFileAsync = promisify(execFile);

async function withTemporaryRepository(run: (repoRoot: string) => Promise<void>): Promise<void> {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codepilot-tools-"));
    try {
        await run(repoRoot);
    } finally {
        await fs.rm(repoRoot, { recursive: true, force: true });
    }
}

async function withMockOllama(
    contents: string[],
    run: (baseUrl: string) => Promise<void>
): Promise<void> {
    let responseIndex = 0;
    const server = http.createServer((_request, response) => {
        const content = contents[Math.min(responseIndex, contents.length - 1)] || "";
        responseIndex++;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ message: { role: "assistant", content } }));
    });

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
    });

    try {
        const address = server.address();
        assert.ok(address && typeof address !== "string");
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

test("find_path locates an existing nested file in the selected repository", async () => {
    await withTemporaryRepository(async repoRoot => {
        await fs.mkdir(path.join(repoRoot, "test"));
        await fs.writeFile(path.join(repoRoot, "test", "dummy.ts"), "export const value = 1;\n");

        const result = await createFindPathTool(createToolContext(repoRoot)).execute({ fileName: "DUMMY.ts" });

        assert.match(result, /test\/dummy\.ts/);
        assert.doesNotMatch(result, /src\/dummy\.ts/);
    });
});

test("search_code rejects filename lookup", async () => {
    await withTemporaryRepository(async repoRoot => {
        const result = await createSearchCodeTool(createToolContext(repoRoot)).execute({ query: "dummy.ts" });
        assert.match(result, /Use find_path/);
    });
});

test("edit_file requires a prior read and preserves unmatched content", async () => {
    await withTemporaryRepository(async repoRoot => {
        const filePath = path.join(repoRoot, "test", "dummy.ts");
        const original = "export const value = 1;\n\nexport function existing() {\n    return value;\n}\n";
        await fs.mkdir(path.dirname(filePath));
        await fs.writeFile(filePath, original);

        const context = createToolContext(repoRoot);
        const editTool = createEditFileTool(context);
        const rejected = await editTool.execute({
            filePath: "test/dummy.ts",
            oldText: "export const value = 1;",
            newText: "export const value = 2;"
        });
        assert.match(rejected, /has not been read/);

        await createReadFileTool(context).execute({ filePath: "test/dummy.ts" });
        const edited = await editTool.execute({
            filePath: "test/dummy.ts",
            oldText: "export const value = 1;",
            newText: "export const value = 1;\n\nexport function add(a: number, b: number) {\n    return a + b;\n}"
        });

        assert.match(edited, /Existing content outside the matched block was preserved/);
        const result = await fs.readFile(filePath, "utf-8");
        assert.match(result, /export function add/);
        assert.match(result, /export function existing/);
        assert.ok(result.endsWith("}\n"));
    });
});

test("append_file adds a function without rewriting existing content", async () => {
    await withTemporaryRepository(async repoRoot => {
        const filePath = path.join(repoRoot, "test", "dummy.ts");
        const original = "export const existing = true;\n";
        await fs.mkdir(path.dirname(filePath));
        await fs.writeFile(filePath, original);
        const context = createToolContext(repoRoot);
        await createReadFileTool(context).execute({ filePath: "test/dummy.ts" });

        const result = await createAppendFileTool(context).execute({
            filePath: "test/dummy.ts",
            content: "export function concatenate(a: string, b: string) {\n    const value = a + b;\n    console.log(value);\n}\n"
        });

        assert.match(result, /All existing file content was preserved/);
        const updated = await fs.readFile(filePath, "utf-8");
        assert.ok(updated.startsWith(original));
        assert.match(updated, /function concatenate/);
        assert.match(updated, /console\.log/);
    });
});

test("read_file reports an existing empty file and permits append_file", async () => {
    await withTemporaryRepository(async repoRoot => {
        const filePath = path.join(repoRoot, "test", "dummy.ts");
        await fs.mkdir(path.dirname(filePath));
        await fs.writeFile(filePath, "");
        const context = createToolContext(repoRoot);

        const readResult = await createReadFileTool(context).execute({ filePath: "test/dummy.ts" });
        assert.match(readResult, /exists and was read successfully/);
        assert.match(readResult, /empty \(0 bytes\)/);
        assert.equal(context.state.readVersions.has("test/dummy.ts"), true);

        const appendResult = await createAppendFileTool(context).execute({
            filePath: "test/dummy.ts",
            content: "export function concatenateAndPrint(a: string, b: string) {\n    console.log(a + b);\n}\n"
        });

        assert.match(appendResult, /Success: Appended new code/);
        assert.match(await fs.readFile(filePath, "utf-8"), /console\.log\(a \+ b\)/);
    });
});

test("edit_file rejects whole-file replacement", async () => {
    await withTemporaryRepository(async repoRoot => {
        const original = "const first = 1;\nconst second = 2;\n";
        await fs.writeFile(path.join(repoRoot, "dummy.ts"), original);
        const context = createToolContext(repoRoot);
        await createReadFileTool(context).execute({ filePath: "dummy.ts" });

        const result = await createEditFileTool(context).execute({
            filePath: "dummy.ts",
            oldText: original,
            newText: "export function replacement() {}\n"
        });

        assert.match(result, /Whole-file replacement is not allowed/);
        assert.equal(await fs.readFile(path.join(repoRoot, "dummy.ts"), "utf-8"), original);
    });
});

test("create_file refuses to create a guessed duplicate filename", async () => {
    await withTemporaryRepository(async repoRoot => {
        await fs.mkdir(path.join(repoRoot, "test"));
        await fs.writeFile(path.join(repoRoot, "test", "dummy.ts"), "export const existing = true;\n");
        const context = createToolContext(repoRoot);

        const result = await createCreateFileTool(context).execute({
            filePath: "src/dummy.ts",
            content: "export const duplicate = true;\n"
        });

        assert.match(result, /already exists at/);
        await assert.rejects(fs.stat(path.join(repoRoot, "src", "dummy.ts")), { code: "ENOENT" });
    });
});

test("create_file is disabled when the task did not request a new file", async () => {
    await withTemporaryRepository(async repoRoot => {
        const context = createToolContext(repoRoot, false);
        const result = await createCreateFileTool(context).execute({
            filePath: "invented.ts",
            content: "export const invented = true;\n"
        });

        assert.match(result, /file creation is disabled/);
        await assert.rejects(fs.stat(path.join(repoRoot, "invented.ts")), { code: "ENOENT" });
    });
});

test("git_diff returns a readable fenced diff for a newly created file", async () => {
    await withTemporaryRepository(async repoRoot => {
        await execFileAsync("git", ["init"], { cwd: repoRoot });
        const context = createToolContext(repoRoot);
        await createCreateFileTool(context).execute({
            filePath: "created.ts",
            content: "export const created = true;\n"
        });

        const result = await createGitDiffTool(context).execute({});

        assert.match(result, /## Changed files/);
        assert.match(result, /\?\? created\.ts/);
        assert.match(result, /```diff/);
        assert.match(result, /\+export const created = true/);
        assert.equal(context.state.diffReviewed, true);
    });
});

test("OllamaProvider parses a complete tagged tool call with nested arguments", async () => {
    await withMockOllama([
        '<tool_call>{"name":"inspect_nested","arguments":{"payload":{"value":42}}}</tool_call>',
        "Completed after inspecting the nested value."
    ], async baseUrl => {
        const registry = new ToolRegistry();
        let received: any;
        registry.registerTool({
            name: "inspect_nested",
            schema: {
                type: "function",
                function: {
                    name: "inspect_nested",
                    description: "Test tool",
                    parameters: { type: "object", properties: {} }
                }
            },
            execute: async args => {
                received = args;
                return "Nested value inspected.";
            }
        });

        const provider = new OllamaProvider("test-model", baseUrl, registry);
        const result = await provider.generateResponse([{ role: "user", content: "Inspect it." }]);

        assert.deepEqual(received, { payload: { value: 42 } });
        assert.equal(result, "Completed after inspecting the nested value.");
    });
});

test("OllamaProvider recovers a fenced tool call with prose and an extra closing brace", async () => {
    await withMockOllama([
        'I will inspect it now.\n```json\n{"name":"inspect_value","arguments":{"value":42}}}\n```',
        "Inspection complete."
    ], async baseUrl => {
        const registry = new ToolRegistry();
        let received: any;
        registry.registerTool({
            name: "inspect_value",
            schema: {
                type: "function",
                function: {
                    name: "inspect_value",
                    description: "Test tool",
                    parameters: { type: "object", properties: {} }
                }
            },
            execute: async args => {
                received = args;
                return "Value inspected.";
            }
        });

        const provider = new OllamaProvider("test-model", baseUrl, registry);
        const result = await provider.generateResponse([{ role: "user", content: "Inspect it." }]);

        assert.deepEqual(received, { value: 42 });
        assert.equal(result, "Inspection complete.");
    });
});

test("OllamaProvider renders a JSON final response as readable Markdown", async () => {
    await withMockOllama([
        '{"summary":"Updated the requested function","files":["test/dummy.ts"],"verification":"passed"}'
    ], async baseUrl => {
        const provider = new OllamaProvider("test-model", baseUrl, new ToolRegistry());
        const result = await provider.generateResponse([{ role: "user", content: "Report the result." }]);

        assert.doesNotMatch(result, /^\s*\{/);
        assert.match(result, /\*\*Summary:\*\* Updated the requested function/);
        assert.match(result, /- test\/dummy\.ts/);
        assert.match(result, /\*\*Verification:\*\* passed/);
    });
});

test("OllamaProvider refuses a final answer until post-edit diff review", async () => {
    await withTemporaryRepository(async repoRoot => {
        await withMockOllama([
            "Finished prematurely.",
            '<tool_call>{"name":"git_diff","arguments":{}}</tool_call>',
            "Finished after reviewing the diff."
        ], async baseUrl => {
            const context = createToolContext(repoRoot);
            context.state.changedFiles.add("test/dummy.ts");
            const registry = new ToolRegistry();
            let diffCalls = 0;
            registry.registerTool({
                name: "git_diff",
                schema: {
                    type: "function",
                    function: {
                        name: "git_diff",
                        description: "Test diff tool",
                        parameters: { type: "object", properties: {} }
                    }
                },
                execute: async () => {
                    diffCalls++;
                    context.state.diffReviewed = true;
                    return "Diff reviewed.";
                }
            });

            const provider = new OllamaProvider("test-model", baseUrl, registry, context.state);
            const result = await provider.generateResponse([{ role: "user", content: "Make a change." }]);

            assert.equal(diffCalls, 1);
            assert.match(result, /^### Recorded execution result/);
            assert.match(result, /Diff reviewed after the last edit: yes/);
            assert.match(result, /Finished after reviewing the diff/);
            assert.doesNotMatch(result, /Finished prematurely/);
        });
    });
});

test("OllamaProvider runs the controller-detected verification command", async () => {
    await withTemporaryRepository(async repoRoot => {
        await withMockOllama([
            "Finished before verification.",
            "Finished after verification."
        ], async baseUrl => {
            const context = createToolContext(repoRoot, false, true, "npm run test");
            context.state.changedFiles.add("test/dummy.ts");
            context.state.diffReviewed = true;
            const registry = new ToolRegistry();
            let receivedCommand = "";
            registry.registerTool({
                name: "run_command",
                schema: {
                    type: "function",
                    function: {
                        name: "run_command",
                        description: "Test command tool",
                        parameters: { type: "object", properties: {} }
                    }
                },
                execute: async args => {
                    receivedCommand = String(args.command);
                    context.state.verificationRun = true;
                    context.state.verificationPassed = true;
                    context.state.verificationCommand = receivedCommand;
                    return "Tests passed.";
                }
            });

            const provider = new OllamaProvider("test-model", baseUrl, registry, context.state);
            const result = await provider.generateResponse([{ role: "user", content: "Change the file." }]);

            assert.equal(receivedCommand, "npm run test");
            assert.match(result, /Verification: passed using `npm run test`/);
            assert.match(result, /Finished after verification/);
            assert.doesNotMatch(result, /Finished before verification/);
        });
    });
});

test("OllamaProvider recovers when the model fabricates a tool_response after find_path", async () => {
    await withTemporaryRepository(async repoRoot => {
        await withMockOllama([
            '<tool_call>{"name":"find_path","arguments":{"fileName":"dummy.ts"}}</tool_call>',
            "<tool_response>File content: console.log('fabricated')</tool_response>",
            '<tool_call>{"name":"read_file","arguments":{"filePath":"test/dummy.ts"}}</tool_call>',
            '<tool_call>{"name":"edit_file","arguments":{"filePath":"test/dummy.ts","oldText":"old","newText":"new"}}</tool_call>',
            '<tool_call>{"name":"git_diff","arguments":{}}</tool_call>',
            "Added the requested function to `test/dummy.ts`."
        ], async baseUrl => {
            const context = createToolContext(repoRoot, false, true);
            const calls: string[] = [];
            const registry = new ToolRegistry();
            const register = (name: string, execute: () => Promise<string>) => registry.registerTool({
                name,
                schema: {
                    type: "function",
                    function: {
                        name,
                        description: `${name} test tool`,
                        parameters: { type: "object", properties: {} }
                    }
                },
                execute: async () => {
                    calls.push(name);
                    return execute();
                }
            });

            register("find_path", async () => "Found: test/dummy.ts");
            register("read_file", async () => {
                context.state.readVersions.set("test/dummy.ts", "read-version");
                return "old";
            });
            register("edit_file", async () => {
                context.state.changedFiles.add("test/dummy.ts");
                context.state.diffReviewed = false;
                return "Edit applied.";
            });
            register("git_diff", async () => {
                context.state.diffReviewed = true;
                return "Diff reviewed.";
            });

            const provider = new OllamaProvider("test-model", baseUrl, registry, context.state);
            const result = await provider.generateResponse([{ role: "user", content: "Add a function to dummy.ts." }]);

            assert.deepEqual(calls, ["find_path", "read_file", "edit_file", "git_diff"]);
            assert.match(result, /Added the requested function/);
            assert.doesNotMatch(result, /fabricated/);
        });
    });
});
