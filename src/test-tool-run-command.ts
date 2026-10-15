import { runCommandTool } from "./tools/run-command.js";

async function test() {
    console.log("=== Test 1: Valid Command (echo) ===");
    const res1 = await runCommandTool.execute({ command: "echo Hello World" });
    console.log(res1 + "\n");

    console.log("=== Test 2: Failing Command ===");
    const res2 = await runCommandTool.execute({ command: "npx tsc --invalidFlag" });
    console.log(res2 + "\n");

    console.log("=== Test 3: Blocked Command ===");
    const res3 = await runCommandTool.execute({ command: "rm -rf node_modules" });
    console.log(res3 + "\n");

    console.log("=== Test 4: Timeout Command (Ping localhost) ===");
    const res4 = await runCommandTool.execute({ command: "ping 127.0.0.1 -n 12" }); // takes > 10s on windows
    console.log(res4 + "\n");
}

test();
