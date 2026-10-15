---
description: Handle non-standard JSON output for tool calls in local LLMs
---

# Local LLM Tool Call Parsing (Qwen)

When implementing AI providers for local models (like Qwen via Ollama), always include a fallback parsing mechanism in the tool-call loop. 

These models frequently fail to populate the native `tool_calls` array, and instead output raw JSON tool calls inside the `content` string.

You must:
1. Parse this JSON manually.
2. Map it to the expected `tool_calls` array format.
3. Explicitly clear the `content` field and assign the parsed tools to `tool_calls` before appending it to the message history.

Failure to do this will result in the AI getting confused by its own history and getting stuck in an infinite loop repeating the same tool call.
