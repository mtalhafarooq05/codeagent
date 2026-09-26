# Local Code Agent — Product Requirements and Delivery Plan

**Status:** Planning draft  
**Primary runtime:** Node.js with TypeScript  
**Primary model host:** Ollama, running locally  
**Primary interface:** Interactive terminal application

## 1. Product summary

Build a small, dependable coding agent that works inside a user-selected project. The user should be able to describe a coding task in natural language, let the agent inspect the project, approve or reject sensitive actions, and receive a clear summary of what changed.

The first version should favor correctness, transparency, and easy maintenance over a large feature set. It should be genuinely useful on normal Node.js/TypeScript projects while remaining open to other project types.

This document describes required behavior and delivery priorities. It intentionally does not prescribe class structures, folders, diagrams, or detailed architecture.

## 2. Product principles

1. **Local first.** Normal use should work with Ollama without sending source code to a cloud service.
2. **User remains in control.** The agent explains meaningful actions and asks before risky or irreversible operations.
3. **Inspect before acting.** The agent learns the project's conventions and available dependencies before proposing changes or commands.
4. **Small, clear changes.** The agent should prefer focused edits and show their effect through a diff.
5. **Provider independence.** Model-specific behavior must stay within provider-specific functionality so that Ollama can later be replaced by OpenAI, Gemini, or another API without rewriting the agent or its tools.
6. **Single Responsibility Principle.** Each part of the product should have one clear reason to change. Tool behavior, model communication, project understanding, permissions, conversation handling, and presentation should not become mixed together.
7. **Clean code over clever code.** Names, behavior, errors, and tests should be easy for another developer to understand.
8. **No surprise dependency changes.** The agent must not install, remove, or upgrade packages merely because it prefers a different library.

## 3. Goals

The first usable release must:

- Run locally from a terminal on Windows, macOS, and Linux where Node.js and Ollama are available.
- Open one project directory as the agent's working boundary.
- Chat with a local Ollama model and stream responses when supported.
- Allow the model to use registered tools in a controlled loop.
- Include tools to list files, read files, write or update files, view Git diffs, and run commands.
- Understand enough of the project environment to use the existing package manager, scripts, module style, language level, and dependencies.
- Prevent accidental access outside the chosen project by default.
- Make provider and model selection configurable.
- Produce readable logs and actionable errors without exposing secrets.
- Be covered by tests for important tool, provider, context, and permission behavior.

## 4. Non-goals for the first release

- A full IDE or graphical user interface.
- Autonomous work that runs unattended for hours.
- Hosting models or downloading model weights on the user's behalf.
- Replacing Git, a terminal, or a package manager.
- Automatic package installation, upgrades, commits, pushes, branch creation, or pull requests.
- Semantic indexing of every repository or a long-term vector database.
- Multiple agents collaborating with each other.
- Remote shell execution or editing outside the selected project.
- Perfect understanding of every programming language and build system.

These may be reconsidered after the core loop is safe and reliable.

## 5. Intended user experience

### 5.1 Starting a session

The user starts the agent in, or points it at, a project directory. The agent then:

1. Confirms the project root and whether it is a Git repository.
2. Checks that the configured model provider is reachable.
3. Shows the selected provider and model.
4. Builds a concise project profile from existing project files.
5. Reports important findings such as the package manager, available scripts, module style, and local instruction files.
6. Waits for a task; it must not edit files or run project commands simply because a session started.

### 5.2 Handling a task

For each task, the agent should:

1. Restate the intended outcome briefly when the request is ambiguous or broad.
2. Inspect only the files and metadata relevant to the task.
3. Use tools through the tool registry rather than pretending an action occurred.
4. Ask for approval when an action crosses the configured safety boundary.
5. Stop a repeated or unproductive loop and explain why.
6. Finish with a concise summary of changes, checks run, failures, and remaining concerns.
7. Offer the final Git diff or show it automatically when files changed.

### 5.3 Interrupting a task

The user must be able to cancel generation or command execution. Cancellation should stop future tool calls and terminate the active command where practical, while preserving completed file changes and reporting what already happened.

## 6. Functional requirements

### 6.1 Agent conversation and task loop

- Support multi-turn conversation within a session.
- Stream normal model output when the provider supports it.
- Support a bounded cycle of model response, tool call, tool result, and follow-up response.
- Enforce configurable limits for tool calls, repeated identical calls, elapsed time, and failed attempts.
- Detect malformed or unsupported tool requests and return a useful correction to the model.
- Never claim a file was read, written, or tested unless the corresponding tool succeeded.
- Keep tool output separate from user and model messages so it can be validated and summarized.
- Allow the user to start a fresh conversation without changing the selected project.

### 6.2 Tool registry

The product must have a central tool registry that is the source of truth for tools available to a model.

Each registered tool must have:

- A unique stable name.
- A plain-language description that helps a model choose it correctly.
- A validated input definition.
- A predictable success or error result.
- A clear risk level and approval rule.
- The ability to be enabled or disabled.

The registry must:

- Reject duplicate tool names.
- Validate model-provided arguments before execution.
- Expose only enabled tools to the active model.
- Make it straightforward to add a tool without modifying unrelated tool behavior.
- Keep tool definitions usable across model providers, even when providers express tool calls differently.
- Record tool start, completion, failure, duration, and a safe summary of the result.

### 6.3 Required tools

#### List files

- List files and directories within the selected project.
- Support a path, depth or result limit, and common filtering needs.
- Respect ignored and generated content by default, including `.git`, dependency folders, build output, and project ignore rules.
- Allow the agent to request an explicit ignored path only when needed and permitted.
- Return deterministic, bounded results rather than flooding the model context.
- Never follow a link that escapes the project boundary by default.

#### Read file

- Read text files within the project.
- Support line ranges so large files can be inspected in parts.
- Report line numbers and whether content was truncated.
- Detect binary or unsupported files and refuse to inject them as text.
- Refuse paths outside the project boundary.
- Avoid displaying likely secret files unless the user explicitly permits it.

#### Write file

- Create a new text file or update an existing text file within the project.
- Preserve the project's normal line endings and text encoding where practical.
- Require unambiguous content and target path.
- Prevent accidental writes outside the project or through escaping links.
- Avoid silent whole-file replacement when the intended change is small.
- Verify that the file still matches the version the agent inspected; if it changed meanwhile, stop and re-read rather than overwriting another change.
- Report what was created or changed and make the result visible through Git diff.
- Never overwrite a likely secret, binary, or generated file without explicit user approval.

#### Git diff

- Show unstaged and staged changes without modifying repository state.
- Allow an optional path filter.
- Handle non-Git projects gracefully.
- Bound large output and clearly report truncation.
- Preserve and distinguish changes that existed before the agent session.
- Never imply that every diff shown was created by the agent.

#### Run command

- Run a command from the project directory, with an optional safe subdirectory.
- Display the exact command and working directory before execution when approval is required.
- Capture standard output, standard error, exit status, duration, and timeout information.
- Stream useful output while keeping a bounded retained result for model context.
- Support cancellation and configurable timeouts.
- Refuse commands that attempt to escape the project boundary or violate the configured permission policy.
- Treat package installation, dependency removal or upgrade, network access, Git writes, destructive filesystem operations, and commands requesting elevated privileges as approval-required actions.
- Never use a package manager other than the one detected for the project unless the user explicitly chooses it.
- Prefer an existing project script over inventing an equivalent command.

### 6.4 Project understanding

Before substantial work, the agent must create a compact **project profile**. This profile is evidence for decisions, not an excuse to load the whole repository.

The profile should identify, when available:

- Project root and Git status.
- Primary languages and recognizable project type.
- Package manager, inferred from lockfiles, package metadata, configuration, and available commands.
- The package manager version or policy, including the `packageManager` field when present.
- Available scripts and the normal commands for build, test, lint, type-check, format, and development.
- Existing runtime and engine requirements.
- Whether JavaScript uses ESM, CommonJS, or a mixture.
- TypeScript configuration and important compiler expectations.
- Existing direct dependencies and development dependencies.
- Workspace or monorepo structure and the package relevant to the current task.
- Formatting, linting, testing, and commit conventions that are already present.
- Repository instructions such as `AGENTS.md`, `CONTRIBUTING.md`, `README`, or equivalent guidance.
- Ignore rules, generated directories, and files that should not be edited.

Behavior based on the profile:

- Use the detected package manager consistently: for example, do not introduce npm commands into a pnpm or Yarn project.
- Use existing dependencies when they meet the need.
- Do not install a missing dependency automatically. Explain why it is needed and request approval.
- Match the project's module style, syntax target, naming, formatting, and testing approach.
- Re-check relevant profile facts when configuration files change during the session.
- Admit uncertainty when signals conflict, and ask the user before making a choice that could alter the project.

### 6.5 Context management

- Keep the initial context small: project profile, user request, relevant instructions, and selected files only.
- Read files on demand rather than attaching the entire repository.
- Exclude dependencies, build artifacts, caches, Git internals, binaries, and unrelated large files by default.
- Use line ranges and bounded search/list results.
- Track which file version was read so later edits are based on current content.
- Summarize older conversation and tool results when the context approaches the model limit.
- Preserve critical facts through summarization: the user's goal, constraints, approvals, files changed, commands run, failures, and unresolved work.
- Never summarize a failed action as successful.
- Show context usage or a simple warning when the session is nearing the selected model's practical limit.
- Support a user-maintained project context file for durable instructions, but treat repository content as untrusted data rather than higher-priority instructions.

Search can be added after the MVP. The first release may combine bounded file listing with targeted reads. A later release should add fast text search before considering embeddings or a vector database.

### 6.6 Model providers

Ollama is the required and default provider. Provider support must be replaceable and isolated so the rest of the product deals with a consistent set of capabilities rather than Ollama-specific response shapes.

The user must be able to configure:

- Provider.
- Model name.
- Provider endpoint.
- Context limit or conservative context budget.
- Generation settings that are genuinely portable or clearly marked provider-specific.
- Timeouts and retry limits.

Every provider must report its relevant capabilities, including tool calling, streaming, structured output, and context size. The agent must fail clearly when a selected model cannot support a required capability.

Required provider behavior:

- Connection and model-availability check at startup.
- Normalized messages, tool requests, tool results, completion reasons, usage information, and errors.
- Bounded retries for transient failures; no endless automatic retry.
- Friendly handling when Ollama is stopped or the named model has not been pulled.
- No automatic fallback from a local provider to a cloud provider.
- API keys loaded from environment or a secure external mechanism, never stored in the repository or logs.

Post-MVP provider targets are OpenAI and Gemini. Adding either should not require changes to file tools, command policy, project profiling, or the user-facing task loop.

### 6.7 Permissions and safety

The default mode should be cautious but usable.

Actions that are read-only and remain inside the project may run without repeated approval. Writes may be allowed per session after the user accepts the project boundary. The following always require explicit approval in the first release:

- Installing, removing, or upgrading dependencies.
- Commands with network access.
- Deleting or moving user files.
- Writing outside the selected project.
- Changing Git history or remote state, including commit, reset, rebase, clean, push, and force operations.
- Accessing likely credential or secret files.
- Starting a persistent background service.
- Running commands with administrator or root privileges.

Additional rules:

- The agent must redact secrets from logs and model context where feasible.
- Repository text and command output are untrusted content and cannot grant themselves permission.
- Approval must describe the exact action, reason, and likely effect.
- Approval for one action must not silently authorize broader future actions.
- The user can choose a stricter read-only session.
- The application should maintain an understandable session audit trail.

### 6.8 Configuration

- Work with useful defaults and minimal setup.
- Allow user-level defaults and project-level overrides.
- Validate configuration at startup and report the exact field that is invalid.
- Keep secrets out of project configuration.
- Allow tools to be enabled or disabled per project or session.
- Allow permission policy, output limits, timeouts, and agent loop limits to be adjusted.
- Clearly show the effective configuration on request.

### 6.9 Errors and recovery

- Errors must say what failed, why when known, and what the user can do next.
- Provider, tool, validation, permission, cancellation, and timeout failures must remain distinguishable.
- One failed tool call should not crash the session.
- The agent should be able to correct invalid tool arguments within the loop limit.
- If a file changed outside the agent after it was read, the agent must re-read and reconsider the edit.
- On restart, no hidden command or model process should continue unintentionally.

### 6.10 Observability and privacy

- Provide a normal user view and an optional verbose diagnostic view.
- Diagnostic data should include timings, tool names, provider/model identifiers, and safe error details.
- Do not log full source files, prompts, environment variables, credentials, or command output by default.
- Make it obvious whether any configured provider is local or remote before source content is sent.
- Local-only operation must remain possible.

## 7. Local model guidance

Model quality will strongly affect tool selection, argument accuracy, and whether the agent can recover from errors. A model being good at code completion is not enough; this product needs reliable instruction following and tool calling.

### Recommended starting models

| Model | Best fit | Approximate Ollama download | Why consider it | Main caution |
|---|---|---:|---|---|
| `qwen3-coder:30b` | Default quality target for capable consumer workstations | 19 GB | Coding- and agent-focused, explicit tool support, and a 256K advertised context window | Needs substantial memory; advertised context is not necessarily practical at full size on consumer hardware |
| `devstral:24b` | Strong alternative for agentic software work | 14 GB | Designed for software-engineering agents and tool use; 128K advertised context | Still expects roughly a high-end consumer setup for good speed |
| `gpt-oss:20b` | General agent behavior and reasoning with tool calls | 14 GB | Native agent/function-calling features and configurable reasoning effort; documented to run with as little as 16 GB memory | Less coding-specialized than the coder models; minimum-memory operation may be slow |
| `qwen3-coder-next` | Higher-end local machines and repository-scale experiments | 52 GB | Agent-focused, tool calling, and a 256K advertised context | Too large for the default recommendation; total memory and context cache needs are significant |
| `qwen3:8b` or another small tool-capable model | Development smoke tests and limited hardware | About 5 GB for `qwen3:8b` | Fast and affordable for exercising the product loop | Noticeably weaker at long, multi-step edits; should not be the quality baseline |

Sources: [Ollama Qwen3-Coder](https://ollama.com/library/qwen3-coder), [Ollama Devstral](https://ollama.com/library/devstral), [Ollama GPT-OSS](https://ollama.com/library/gpt-oss), [Ollama Qwen3-Coder-Next](https://ollama.com/library/qwen3-coder-next), and [Ollama tool-calling documentation](https://docs.ollama.com/capabilities/tool-calling).

### Initial recommendation

- Use `qwen3-coder:30b` as the main quality benchmark when the machine has enough memory.
- Use `devstral:24b` as the first comparison model because it is explicitly intended for coding-agent workflows and has a smaller download.
- Use `gpt-oss:20b` to validate that the provider and tool system do not accidentally depend on one model family's formatting.
- Keep a small model such as `qwen3:8b` in the test matrix, but clearly label it as a reduced-capability option.
- Do not make `qwen3-coder-next` the default despite its strengths; its 52 GB model footprint makes it unsuitable for many local machines.

Model download size is not the full runtime requirement. Available RAM/VRAM, context length, context-cache size, quantization, and acceptable speed all matter. The setup guide should ask for the user's hardware and recommend a conservative model/context combination rather than promising that any advertised context window will be practical.

### Model acceptance test

Before declaring a model supported, test it on the same small evaluation set:

- Chooses read before write when it lacks file contents.
- Calls the correct tool with valid arguments.
- Respects the project boundary and an approval denial.
- Reads package metadata and selects the existing package manager.
- Avoids proposing an already-installed alternative dependency.
- Makes a focused multi-file change and then checks the diff.
- Recovers from a tool error without repeating forever.
- Stops when the requested result is complete.

Record success rate, invalid tool calls, unnecessary tool calls, completion time, and peak memory. Model selection should be based on this agent-specific evaluation plus hardware fit, not a general coding leaderboard alone.

## 8. Clean-code and SRP requirements

These are maintainability requirements rather than an internal design prescription:

- A change to one provider must not require edits to unrelated providers or tools.
- A change to one tool must not require edits to unrelated tools.
- Permission decisions must be consistent across tools rather than reimplemented differently in each tool.
- Project detection must be independently testable from model behavior.
- Terminal presentation must not contain business rules required for headless use.
- External input must be validated at its boundary.
- Provider-specific types and response details must not spread through the rest of the product.
- Avoid large catch-all modules, hidden global state, duplicated validation, and unexplained side effects.
- Public behavior should be documented, and non-obvious choices should have short rationale comments rather than narration of the code.
- Strict TypeScript settings, automated formatting, linting, and tests are required from the start.

## 9. Quality requirements

### Reliability

- File writes must not leave partial content after a process failure where atomic replacement is practical.
- A failed provider response or malformed tool request must not corrupt session state.
- Commands and model requests must have timeouts.
- Repeated identical failing actions must be stopped.

### Performance

- Startup project profiling should feel quick on an ordinary repository and avoid scanning dependency/build folders.
- First streamed feedback should appear as soon as the provider supplies it.
- Large file listings, reads, diffs, and command outputs must be bounded.
- The agent should avoid re-reading unchanged files unnecessarily.

### Portability

- Support actively maintained Node.js LTS releases.
- Behave correctly on Windows and POSIX-style shells without assuming one command syntax.
- Paths shown to the user should be understandable on the current platform.

### Accessibility and usability

- Important status must not depend only on color.
- Prompts should clearly distinguish information from approval requests.
- Errors and final summaries should be readable without verbose mode.

## 10. Delivery plan

### Phase 1 — Walking skeleton

Deliver a terminal conversation with Ollama, model selection, streaming text, cancellation, configuration validation, and a provider health check. Prove that provider-specific behavior is contained by using a fake provider in automated tests.

**Exit condition:** A user can start a session, talk to a selected local model, cancel it, and understand connection or model errors.

### Phase 2 — Safe read-only assistant

Add the tool registry, file listing, file reading, Git diff, project boundary enforcement, basic project profiling, bounded context, and session logging.

**Exit condition:** The agent can accurately explain an unfamiliar Node.js/TypeScript project without changing it and cannot read outside the selected root.

### Phase 3 — Controlled changes

Add file creation/update, conflict detection, permissions, approval prompts, diff review, and protection for secrets, binaries, generated files, and pre-existing user changes.

**Exit condition:** The agent can make a small requested change, preserve unrelated work, show the resulting diff, and stop safely when approval is denied.

### Phase 4 — Command execution

Add command execution, streaming output, timeout/cancellation, risky-command approval, package-manager consistency, and preference for existing scripts.

**Exit condition:** The agent can run the project's existing checks, accurately report failures, and cannot silently install packages or perform dangerous Git operations.

### Phase 5 — Hardening and model evaluation

Run the supported-model acceptance set, add cross-platform coverage, improve context summarization, test malformed calls and prompt-injection cases, and document setup/troubleshooting.

**Exit condition:** The recommended models meet the agreed success threshold, core safety tests pass on supported platforms, and a new user can set up the product from the documentation.

### Phase 6 — Provider portability proof

Add one non-Ollama provider, preferably chosen by actual user demand, and confirm that no file tools, command rules, project profiling, or task behavior require provider-specific changes.

**Exit condition:** The same core evaluation tasks run through Ollama and the second provider with only configuration differences.

## 11. MVP acceptance checklist

The MVP is complete when all of the following are demonstrably true:

- [ ] The app runs locally with Node.js, TypeScript, Ollama, and a documented supported model.
- [ ] The user can select a project, provider, and model.
- [ ] The app detects an unavailable Ollama service or missing model and gives a corrective message.
- [ ] The model can call enabled tools through the registry with validated arguments.
- [ ] List and read tools cannot escape the project root.
- [ ] Write behavior detects stale content and does not overwrite concurrent changes.
- [ ] Git diff separates or clearly labels pre-existing changes.
- [ ] Command execution supports timeout, cancellation, captured exit status, and bounded output.
- [ ] Dependency and dangerous operations require explicit approval.
- [ ] The agent detects package manager, scripts, module style, TypeScript settings, and existing dependencies before relevant work.
- [ ] The agent does not silently install or substitute packages.
- [ ] Context remains bounded on a representative medium-sized repository.
- [ ] The user receives an accurate final summary and diff after edits.
- [ ] Provider-specific details do not appear in tool and project-understanding tests.
- [ ] Important safety, tool, provider, and context behaviors have automated tests.
- [ ] Setup, configuration, supported models, privacy behavior, and limitations are documented.

## 12. Decisions to make before implementation

These decisions should be settled with small experiments rather than prolonged design discussion:

1. Minimum supported Node.js LTS version.
2. Default package manager for developing this product itself.
3. Exact default approval policy for ordinary in-project file writes.
4. Whether the MVP write tool accepts full replacement content, structured edits, or both.
5. Session persistence: memory-only for MVP or an opt-in local history file.
6. Supported shell behavior on Windows versus POSIX systems.
7. Practical default context budget for each recommended local model.
8. Hardware tiers shown in onboarding and the minimum acceptable tokens-per-second experience.
9. Quantitative pass threshold for a model to be labeled “supported.”
10. Which cloud provider, if any, should be used for the Phase 6 portability proof.

## 13. Possible follow-up features

After the MVP is stable, consider:

- Fast text search as a registered tool.
- Apply-patch style editing for smaller and more reviewable changes.
- Optional read-only planning mode.
- Checkpoints or recoverable edit snapshots.
- User-defined tools and tool groups.
- Task-specific project notes.
- Session resume with privacy controls.
- A dry-run view of proposed commands and edits.
- Model profiles tuned for speed, quality, or low memory.
- Optional OpenAI-compatible, OpenAI, Gemini, or other providers.
- An editor integration built on the same product behavior.

Each follow-up should earn its place through user need and must preserve the project boundary, permission model, SRP, and provider independence established by the MVP.

## 14. Security concerns

A coding agent combines model-generated decisions with file and command access. That makes it more powerful—and more dangerous—than a normal chat application. The model must therefore be treated as an untrusted decision-maker whose requested actions are checked by deterministic application rules.

No single safeguard is enough. Project boundaries, validation, permissions, process restrictions, secret handling, audit records, and clear user approvals must work together.

| Security concern | Why it can become a security issue | Can it be solved? | Required response |
|---|---|---|---|
| Prompt injection in repository files | Source files, README content, issue text, generated files, or command output can contain instructions telling the model to ignore the user, reveal data, or run dangerous tools. | **Mitigated, not fully solved.** Models can still be influenced by hostile text. | Treat all project content and tool output as untrusted data. Never allow text from the repository to change permissions, project boundaries, or higher-priority rules. Require deterministic checks and user approval for sensitive actions. |
| Command injection | Model-generated shell text may contain separators, substitutions, redirections, or quoting tricks that run more than the visible intended command. | **Largely mitigated.** Risk remains when arbitrary shell mode is allowed. | Prefer executable-plus-argument execution instead of passing strings through a shell. Validate arguments, show the exact action for approval, and reserve raw shell execution for an explicitly approved advanced mode. |
| Malicious project scripts | A normal-looking `test`, `build`, lifecycle, or package script can execute arbitrary code, access files, or contact the network. Existing scripts are not automatically safe. | **Mitigated, not fully solved.** Running project code always carries risk. | Show the resolved script and its source definition before first execution in an untrusted project. Apply time, filesystem, environment, and network restrictions where available, and require approval for scripts with elevated risk. |
| Path traversal | Inputs such as `../`, absolute paths, alternate path separators, or encoded paths may let a tool read or write outside the selected project. | **Yes, for normal filesystem access.** | Resolve and normalize every path, compare it with the canonical project root, and reject anything outside it before filesystem access. Test Windows and POSIX path edge cases. |
| Symbolic links, junctions, and path races | A path can appear to be inside the project but resolve outside it through a symlink or Windows junction. A target can also change between validation and use. | **Mitigated, not always fully solved on every platform.** | Check real paths, reject escaping links by default, revalidate at the time of access, and use safe file-opening and atomic-write behavior where the platform supports it. |
| Secret exposure to the model | `.env` files, tokens, SSH keys, cloud credentials, configuration, source code, and command output may contain secrets. Even a local model may reproduce them in output or logs. | **Mitigated, not fully solved.** Secret detection is imperfect. | Block known secret paths by default, scan and redact likely secrets, minimize environment variables passed to commands, avoid including unnecessary content in context, and require explicit approval for sensitive files. |
| Accidental cloud data transfer | Switching to OpenAI, Gemini, a remote Ollama endpoint, or another hosted provider may send private source code and secrets off the machine. | **Yes, as a policy control; provider-side privacy still depends on that service.** | Clearly label local versus remote providers, warn before the first remote request for a project, never fall back to cloud automatically, and allow local-only mode to disable all remote providers and network tools. |
| Overly broad filesystem permissions | If the agent process can access the entire user account, a tool bug or compromised model decision may reach personal files even when the project boundary is intended to prevent it. | **Mitigated.** Application checks can fail, so operating-system isolation is preferable. | Run with least privilege, support sandboxing where available, keep the default boundary to one project, and never request administrator/root access for routine work. |
| Destructive commands | Commands such as recursive deletion, Git cleanup/reset, disk utilities, or broad move operations can permanently destroy work. | **Largely mitigated.** User-approved destructive actions still carry residual risk. | Deny known destructive patterns by default, require targeted approval, resolve exact affected paths, prefer recoverable operations, and recommend a clean Git state or backup before high-impact work. |
| Git history or remote modification | Commit, reset, rebase, clean, push, and force operations can rewrite history, publish secrets, or destroy uncommitted changes. | **Yes, for the default mode.** | Keep Git tools read-only in the MVP. Any later Git-write capability must be separately enabled, narrowly approved, and must never include an automatic force push. |
| Dependency supply-chain attacks | Installing a package runs third-party code through install scripts and may introduce typosquatted, compromised, or vulnerable dependencies. | **Mitigated, not fully solved.** External packages cannot be guaranteed safe. | Never install automatically. Confirm the exact package, version, registry, lockfile changes, and reason; prefer existing dependencies; allow script-disabled installation where appropriate; and recommend audit/review after changes. |
| Package-manager lifecycle hooks | Install, update, and sometimes other package-manager commands may run `preinstall`, `postinstall`, or similar hooks with the user's permissions. | **Mitigated.** | Treat package-manager mutations as code execution, require approval, disclose that lifecycle scripts may run, and provide a safer scripts-disabled option when supported by the detected package manager. |
| Untrusted executable resolution | A project may contain a malicious executable whose name shadows a trusted system command, or the environment `PATH` may resolve an unexpected program. | **Mitigated.** | Use a controlled environment, report the resolved executable where practical, prefer package-manager scripts and project-local binaries intentionally, and avoid modifying `PATH` based on model output. |
| Environment-variable leakage | Child commands may inherit API keys and other credentials that are unrelated to the task, and malicious code can read or transmit them. | **Largely mitigated.** | Pass a minimal allowlisted environment to child processes, add only variables required by the command, and redact environment values from logs and errors. |
| Network-based data exfiltration | A command or tool can send source code, credentials, or machine information through HTTP, package registries, Git remotes, DNS, or another protocol. | **Mitigated; fully preventable only with reliable network isolation.** | Default to no network for agent-run commands where feasible. Require approval for network access, show the destination when known, and support an offline mode enforced below the model layer. |
| Exposed Ollama or agent service | Binding a local API to a public network interface without authentication may let another machine use the model, consume resources, or submit tool-driving prompts. | **Yes, with correct deployment controls.** | Bind services to loopback by default, do not expose tool execution through an unauthenticated network API, and require authentication plus transport security for any intentional remote access. |
| Tool argument confusion or hallucination | A model may call the wrong tool, omit required values, invent fields, or pass unexpectedly large inputs. | **Yes, at the execution boundary.** | Validate every call against strict schemas, reject unknown fields where appropriate, enforce size and range limits, and never coerce ambiguous input into a risky action. |
| Tool-name or tool-description manipulation | A plugin or project-defined tool could impersonate a trusted tool or use a misleading description to gain model selection. | **Yes, if extension rules are controlled.** | Reject duplicate or reserved names, identify the source of every tool, require user approval before enabling third-party tools, and display their permissions and risk levels. |
| Unsafe third-party or user-defined tools | Extra tools can bypass the core filesystem, permission, logging, and network rules. | **Mitigated, not fully solved.** Third-party code executes with whatever privileges it receives. | Disable external tools by default, require an explicit trust decision, isolate them where possible, limit granted capabilities, and make it clear that installed tool code is part of the trusted computing base. |
| Terminal escape-sequence attacks | File names or command output can contain ANSI/control sequences that alter the terminal display, disguise text, create misleading links, or manipulate clipboard-capable terminals. | **Largely mitigated.** | Sanitize untrusted terminal output, escape control characters, disable unsafe hyperlink/control sequences, and offer raw output only through an explicit diagnostic option. |
| Misleading approval prompts | A prompt may hide the real command, omit affected paths, or overwhelm the user until they approve without understanding. | **Mitigated, not fully solved.** Human attention remains a weak point. | Keep approvals rare and specific. Show the exact command/action, working directory, affected paths, network destination, and reason. Never bundle unrelated permissions or treat silence as consent. |
| Stale reads and concurrent changes | The user, editor, formatter, or another process may change a file after the agent reads it, causing the agent to overwrite new work or validate the wrong content. | **Yes, for normal edits.** | Compare the current file with the version previously read, refuse stale writes, re-read before retrying, and use atomic replacement when practical. |
| Pre-existing changes mistaken for agent changes | The agent may overwrite, revert, or take credit for work already present in the working tree. | **Yes.** | Capture initial Git status/diff metadata, preserve unrelated edits, label pre-existing changes, and never run cleanup or revert operations automatically. |
| Resource exhaustion and denial of service | Huge files, recursive directories, endless command output, fork bombs, long model generations, or repeated tool loops can consume memory, CPU, disk, or tokens. | **Largely mitigated.** | Enforce size, depth, output, concurrency, time, and tool-loop limits. Support cancellation, terminate process trees where possible, and stop repeated identical failures. |
| Sensitive logs and session history | Prompts, source snippets, diffs, tool output, paths, and errors can remain on disk and expose private information later. | **Yes, with a clear retention policy.** | Keep detailed persistence opt-in, redact secrets, restrict file permissions, document storage location and retention, support deletion, and avoid logging full content by default. |
| Error-message information leakage | Stack traces and provider or operating-system errors may reveal usernames, local paths, tokens, endpoints, or internal details. | **Largely mitigated.** | Present sanitized errors in normal mode, keep sensitive diagnostics behind explicit verbose mode, and apply redaction before any error is logged or sent to a model. |
| Insecure configuration and credentials | API keys stored in project files may be committed; permissive configuration may silently weaken safety for every session. | **Yes, for product-managed settings.** | Keep secrets in environment variables or secure credential storage, separate user and project settings, warn about unsafe overrides, and never allow repository content to enable broader permissions by itself. |
| Provider response or stream tampering | A compromised remote endpoint, proxy, or local service may return malformed events, fake tool calls, or excessive data. | **Mitigated.** | Use authenticated encrypted connections for remote providers, validate all response shapes and sizes, treat provider tool calls as requests rather than authority, and fail closed on invalid data. |
| Compromised model or model package | A downloaded model, runtime, or provider integration could be tampered with or behave maliciously. | **Mitigated, not fully solved.** | Obtain models and runtimes from trusted sources, verify checksums/signatures when available, pin known versions for supported setups, keep tool permissions outside the model, and publish tested model identifiers. |
| Application update supply chain | A compromised npm dependency, build pipeline, release artifact, or automatic updater could gain all permissions held by the agent. | **Mitigated, not fully solved.** | Pin dependencies through a lockfile, review updates, minimize dependencies, scan releases, protect publishing credentials, produce reproducible or signed artifacts where practical, and avoid silent self-update in the MVP. |
| Cross-platform shell differences | A command considered safe on one shell may have different quoting, expansion, or executable behavior on another. | **Mitigated.** | Avoid raw shell strings, test supported operating systems, keep platform-specific execution behavior explicit, and reject constructs that cannot be interpreted safely. |
| Sandbox escape or sandbox absence | A software sandbox may contain vulnerabilities, and some operating systems or installations may not provide a reliable sandbox at all. | **Not fully solvable within this application.** | Treat sandboxing as defense in depth, clearly report when it is unavailable, retain permission and boundary checks outside the sandbox, and recommend running untrusted repositories in a disposable VM or container. |
| Social engineering through agent output | The model may confidently ask the user to weaken security, paste credentials, disable protections, or approve an unnecessary action. | **Mitigated, not fully solved.** | Instruct the agent never to request secrets or recommend bypassing safeguards as a convenience. Make security warnings application-generated where possible and require explicit, narrowly scoped decisions. |

### Security release gate

Before the MVP is considered ready, it must pass dedicated tests for:

- Path traversal, absolute paths, alternate separators, symlinks, and Windows junctions.
- Command metacharacters, quoting edge cases, environment leakage, timeouts, cancellation, and process-tree cleanup.
- Prompt injection placed in source files, filenames, repository instructions, and command output.
- Secret-file blocking and redaction in logs, errors, diffs, and model context.
- Approval denial, approval scope, and attempts by project content to grant itself permission.
- Large files, deep directory trees, endless output, repeated tool calls, and malformed provider streams.
- Concurrent file modification and preservation of pre-existing Git changes.
- Local-only mode with proof that model, command, and tool workflows cannot make unintended network requests.

Security is not a one-time checklist. New providers, tools, platforms, command capabilities, persistence, plugins, and network features must receive a security review before release because each expands what untrusted model output can influence.
