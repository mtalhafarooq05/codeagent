# Local Code Agent

A small, local-first TypeScript coding assistant. This version is **read-only**: it chats through Ollama, summarizes a project's directory and package metadata, and lets the model navigate project directories and read selected text files through guarded tools. It cannot write files, use Git, or execute commands.

## Prerequisites

- Node.js 22 or newer
- npm
- Ollama installed and running locally
- The `qwen3:8b` model, downloaded separately:

```sh
ollama pull qwen3:8b
```

The app does not download or switch models automatically.

## Run

```sh
npm install
npm run dev
```

To inspect a different project:

```sh
npm run dev -- --project path/to/project
```

Optional settings:

```sh
npm run dev -- --model qwen3:8b --host http://127.0.0.1:11434
```

The Ollama endpoint is restricted to local HTTP hosts in this phase. `CODE_AGENT_MODEL` and `CODE_AGENT_OLLAMA_HOST` may also be set as environment variables.

Session commands: `/context` refreshes and displays project metadata, `/clear` starts a fresh conversation, `/help` shows usage, and `/exit` quits. Press Ctrl+C to cancel a generation or leave an idle session.

## Available model tools

`list_directory` lists one level of a project directory, with directories first. It defaults to the project root, skips symlinks and common noisy/generated directories, and returns the first 200 entries in directory-first alphabetical order. Enumeration is incremental, cancellation-aware, and keeps a bounded result set even for large directories.

`read_file` reads a project-relative UTF-8 text file or an inclusive line range. Every call passes through the tool registry and a shared project-path resolver. The tool opens and revalidates one file handle, then rejects paths outside the project, absolute paths, symlinks/junctions, directories, likely secret files, binary/invalid UTF-8 files, and files larger than 1 MiB. A response is limited to 200 lines and 32,000 characters; truncated results include `nextStartLine` so the model can continue without skipping content.

The registry validates every model-generated argument object against its tool's JSON schema with Ajv before execution. Tool code separately enforces behavioral and security policies.

The session permits at most four tool calls in one model response and eight in one user request. Cancellation is checked between calls, and interim model text is not shown when the same response requests a tool.

## What the project inspector sees

It reads the selected project's root `package.json`, looks for a lockfile and TypeScript/workspace configuration, and collects a bounded file tree. It reports the package manager, module style, script names and commands, dependency counts, and whether TypeScript or a workspace was detected. Common generated/dependency directories and symlinks are skipped. The model may then explore with `list_directory` and request individual source files through `read_file`; it still cannot execute project scripts.

Project metadata is sent to the configured local Ollama model as context. The current directory is used unless `--project` is provided.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

See [REQUIREMENTS.md](./REQUIREMENTS.md) for the broader product plan.
