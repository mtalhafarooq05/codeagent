import { readFileTool } from "./tools/read-file.js";
import { searchCodeTool } from "./tools/search-code.js";

async function test() {
    console.log("=== Test 1: Reading a valid file (package.json) ===");
    const validContent = await readFileTool.execute({ filePath: "package.json" });
    console.log(validContent.slice(0, 120) + "...\n");

    console.log("=== Test 2: Reading a non-existent file ===");
    const missing = await readFileTool.execute({ filePath: "does-not-exist.txt" });
    console.log(missing + "\n");

    console.log("=== Test 3: Attempting directory traversal (security check) ===");
    const blocked = await readFileTool.execute({ filePath: "../../Windows/System32/drivers/etc/hosts" });
    console.log(blocked + "\n");

    console.log("=== Test 4: Attempting to read a folder as a file ===");
    const folder = await readFileTool.execute({ filePath: "src" });
    console.log(folder + "\n");

    console.log("=== Test 5: Searching for 'IGNORED_DIRECTORIES' in code ===");
    const searchResults = await searchCodeTool.execute({ query: "IGNORED_DIRECTORIES" });
    console.log(searchResults + "\n");
}

test();
