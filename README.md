# CodePilot (CodingAgent)

An autonomous, local software-engineering coding agent built in TypeScript that executes tasks on local repositories using local language models (via [Ollama](https://ollama.ai) with `qwen2.5-coder`).

> [!NOTE]
> **Experiment & Learning Purpose:**
> This project is an experimental exploration designed to study agentic workflows, LLM reasoning, context engineering, and practical techniques to **eliminate hallucinations and prevent reckless code modifications** when running autonomous software engineering agents on local open-weight models.

---

## 🎯 Background & Motivation

Autonomous coding agents (like Devin, Claude Engineer, or Aider) often rely on massive frontier cloud models. Running code agents with **local models** presents unique hurdles:
1. **Tool-Call Hallucinations**: Smaller models frequently generate fake tool output (e.g. authoring their own `<tool_response>` tags instead of waiting for the environment).
2. **Reckless File Overwrites**: Models often overwrite or erase 90% of an existing file instead of making targeted, surgical edits.
3. **Premature Completion**: Models routinely declare "Task completed!" after merely planning or reading a file, without executing any actual code edits.
4. **Tool Confusion**: Misusing content search tools (like `grep`) to search for file names, or guessing invalid paths.
5. **Skipping Verification**: Failing to review `git diff` or run test suites after introducing modifications.

**CodePilot** tackles these challenges by placing the local model inside a **rigid, state-enforced supervisory controller** with defensive tools and automated verification.

---

## 🏗️ Architecture & How It Works

```
                     ┌────────────────────────────────────────┐
                     │           User Command & Repo          │
                     └───────────────────┬────────────────────┘
                                         │
                     ┌───────────────────▼────────────────────┐
                     │          Pre-flight Inspection         │
                     │  - fs-inspector       - git-inspector  │
                     │  - project-inspector  - language-tools │
                     └───────────────────┬────────────────────┘
                                         │
                                         │ Context & File Manifest
                                         ▼
                     ┌────────────────────────────────────────┐
                     │          Prompt Construction           │
                     │  - Strict system prompt & rules        │
                     │  - Project scripts & tooling manifest  │
                     └───────────────────┬────────────────────┘
                                         │
                         ┌───────────────▼────────────────┐
                         │   Ollama Agentic Loop (API)    │
                         │      (Model: qwen2.5-coder)    │
                         └───────┬────────────────▲───────┘
                                 │                │
                      Tool Call  │                │ Tool Result
                                 ▼                │
   ┌──────────────────────────────────────────────┴───────────────────────────┐
   │                          Supervisory Controller                          │
   │  ──────────────────────────────────────────────────────────────────────  │
   │  🛡️ Anti-Fabrication Filter : Discards model-authored <tool_response>   │
   │  📋 Multi-Format Parser     : Parses native JSON, XML tags, & fences    │
   │  🛑 Mutation Enforcement    : Rejects completion if no edit was made    │
   │  🔍 Mandatory Diff Review   : Requires `git_diff` review after changes   │
   │  🧪 Auto Verification       : Runs detected `npm test` automatically     │
   │  📊 Execution Summary       : Deterministic factual summary in output   │
   └─────────────────────────────────────┬────────────────────────────────────┘
                                         │
                                         ▼
   ┌──────────────────────────────────────────────────────────────────────────┐
   │                         Defensive Native Tools                           │
   │  ──────────────────────────────────────────────────────────────────────  │
   │  • find_path     : Exact filename lookup across repository               │
   │  • search_code   : Greps contents (blocks filename queries)              │
   │  • read_file     : Reads contents & records SHA-256 session hash         │
   │  • edit_file     : Surgical replace (requires read, blocks whole wipes)  │
   │  • append_file   : Appends new code cleanly, preserving existing content │
   │  • create_file   : Disabled unless requested; blocks duplicate names     │
   │  • git_diff      : Unified diff of all uncommitted workspace changes     │
   │  • run_command   : Sandboxed execution with dangerous-command deny-list  │
   └──────────────────────────────────────────────────────────────────────────┘
```

---

## 🛡️ Key Guardrails & Context Engineering

### 1. Pre-Flight Repository Context
Before invoking the model, CodePilot gathers deterministic facts:
- **Manifest Generation** (`src/fs-inspector.ts`): Recursively traverses the directory tree (ignoring `.git`, `node_modules`, `dist`, etc.) to produce a canonical file list capped at 600 files.
- **Capabilities Inspection** (`src/project-inspector.ts`): Parses `package.json` and `tsconfig.json` to expose available scripts (`test`, `typecheck`, `build`), the package manager (`npm`, `yarn`, `pnpm`), and installed dependencies (`jest`, `tsx`, `typescript`). The model is strictly instructed to use existing scripts rather than hallucinating commands.
- **Git Context** (`src/git-inspector.ts`): Checks current branch and whether uncommitted changes already exist.

### 2. Guardrails in `OllamaProvider`
- **Rejection of Fabricated Responses**: Intercepts and discards model outputs containing `<tool_response>` tags, forcing the model to wait for real environment outputs.
- **State Tracker (`AgentSessionState`)**:
  - Tracks all mutated files in `changedFiles`.
  - Tracks SHA-256 content hashes of files read via `read_file`.
  - Enforces `diffReviewed = false` upon every edit.
- **Premature Completion Guard**: If the task was a modification task, the controller refuses to terminate if no files were mutated.
- **Mandatory Diff Review**: Refuses final response until the model calls `git_diff` to review its changes.
- **Automated Verification Loop**: Automatically triggers `run_command` with detected test/verification commands once modifications are complete.

### 3. Defensive Tool Safety
- **Path Traversal Protection** (`src/utils/path-security.ts`): Every file operation is validated via `resolveSafePath` against the repository root.
- **Surgical Edits** (`src/tools/edit-file.ts`):
  - Requires the target file to have been read in the current session.
  - Rejects stale edits if the file changed on disk after reading.
  - Requires `oldText` to match exactly one unique block.
  - Disallows whole-file replacement or deletions removing >50% of file content.
  - Writes atomically via `.tmp` files.
- **Accidental File Creation Prevention** (`src/tools/write-file.ts`):
  - Refuses execution unless the task explicitly requested a new file.
  - Refuses to create files with names that already exist anywhere in the repository tree.
- **Command Sandbox** (`src/tools/run-command.ts`):
  - Enforces a 10-second timeout.
  - Denies destructive commands (`rm -rf`, `del`, `sudo`, `mkfs`, `format`) and network/install commands (`npm install`, `curl`, `wget`).

---

## 🚀 Getting Started

### Prerequisites

1. **Node.js**: v18.0.0 or later (Node 20+ recommended).
2. **Git**: Installed and available in your `PATH`.
3. **Ollama**: Installed and running locally.
   - Download from [ollama.ai](https://ollama.ai).
   - Pull the coding model:
     ```bash
     ollama pull qwen2.5-coder
     ```
   - Ensure Ollama is active at `http://localhost:11434`.

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/mtalhafarooq05/codingagent.git
cd codingagent
npm install
```

---

## 💻 How to Use

### Run the Agent on a Target Repository

Use `npm run dev` followed by the target repository path and your task instruction:

```bash
npm run dev -- <path-to-repo> "<task description>"
```

#### Examples:

**1. Inspect and summarize a repository:**
```bash
npm run dev -- ../my-project "Analyze this repository and summarize what you see."
```

**2. Add a new function or feature:**
```bash
npm run dev -- ../my-project "Add a helper function in utils/math.ts to calculate factorial and export it."
```

**3. Fix a bug or failing test:**
```bash
npm run dev -- ../my-project "Fix the test failure in test/auth.test.ts."
```

---

## 🧪 Testing & Verification

The project includes unit tests verifying tool behavior, anti-hallucination guardrails, and parsing logic, as well as an end-to-end smoke test:

### 1. Run Unit & Guardrail Tests
```bash
npm test
```
Runs 15 test suites validating:
- Exact path finding and grep separation
- `edit_file` anti-erasure, hash check, and unique block matching
- `append_file` non-destructive additions
- `create_file` duplicate-name rejection
- Model tool parsing and fabricated `<tool_response>` rejection
- Controller-enforced diff review and verification runs

### 2. Type-Checking
```bash
npm run typecheck
```

### 3. End-to-End Smoke Test
```bash
npm run smoke
```
Initializes a temporary git repository fixture, executes the full agent with Ollama (`qwen2.5-coder`), verifies that the model locates `dummy.ts`, preserves existing code, appends new logic, diffs, and finishes successfully.

---

## 📁 Repository Structure

```
├── package.json               # Scripts and dependencies
├── tsconfig.json              # TypeScript compilation configuration
├── scripts/
│   ├── run-agent.mjs          # Agent runner script
│   ├── smoke-agent.mjs        # End-to-end smoke test with fixture repo
│   └── run-tests.mjs          # Test runner script
└── src/
    ├── index.ts               # CLI entry point and setup
    ├── config.ts              # Global configurations and ignored folders
    ├── fs-inspector.ts        # Recursive directory inspection
    ├── git-inspector.ts       # Git repository and branch status
    ├── project-inspector.ts   # package.json and tsconfig capabilities analyzer
    ├── language-analyzer.ts   # File extension language analyzer
    ├── prompt-builder.ts      # Context injection and prompt builder
    ├── ai/
    │   ├── provider.ts        # AI interfaces and message models
    │   └── ollama-provider.ts # Ollama agentic loop, parser, and guardrails
    ├── tools/
    │   ├── context.ts         # Session state, read tracking & SHA-256 hashes
    │   ├── registry.ts        # Tool registry and dispatcher
    │   ├── read-file.ts       # File reader tool
    │   ├── edit-file.ts       # Surgical find-and-replace edit tool
    │   ├── append-file.ts     # Non-destructive file append tool
    │   ├── write-file.ts      # New file creation tool
    │   ├── find-path.ts       # Exact filename lookup tool
    │   ├── search-code.ts     # Grep content search tool
    │   ├── git-diff.ts        # Git diff viewer tool
    │   └── run-command.ts     # Safe terminal command runner
    └── utils/
        └── path-security.ts   # Path traversal security validator
```

---

## 🔬 Lessons Learned & Takeaways

1. **Context Manifests Beat Endless Search**: Giving the model a flat manifest of paths at the start drastically reduces random searching and hallucinated paths.
2. **Deterministic Guardrails are Essential**: Local models (sub-32B) cannot be solely relied upon to adhere to honor-system prompt instructions. Enforcing state checks in code (e.g. requiring git diff and verifying file hashes) yields drastically higher task completion rates.
3. **Surgical Editing vs. Whole-File Rewriting**: Prohibiting whole-file replacement eliminates the single biggest source of code corruption when using local LLMs.

---

## 📄 License

ISC License. See [package.json](package.json).
