import { resolve } from 'node:path';

export interface AppConfig {
  projectRoot: string;
  model: string;
  ollamaHost: string;
}

const DEFAULT_MODEL = 'qwen3:8b';
const DEFAULT_HOST = 'http://127.0.0.1:11434';

export function parseConfig(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): AppConfig {
  let projectRoot = cwd;
  let model = env.CODE_AGENT_MODEL || DEFAULT_MODEL;
  let ollamaHost = env.CODE_AGENT_OLLAMA_HOST || DEFAULT_HOST;

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];

    if (option === '--help' || option === '-h') {
      throw new HelpRequested();
    }

    if (option !== '--project' && option !== '--model' && option !== '--host') {
      throw new Error(`Unknown option: ${option}. Use --help for usage.`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${option}.`);
    }
    index += 1;

    if (option === '--project') projectRoot = value;
    if (option === '--model') model = value;
    if (option === '--host') ollamaHost = value;
  }

  if (!model.trim()) throw new Error('Model name cannot be empty.');

  let hostUrl: URL;
  try {
    hostUrl = new URL(ollamaHost);
  } catch {
    throw new Error(`Invalid Ollama host URL: ${ollamaHost}`);
  }

  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (hostUrl.protocol !== 'http:' || !allowedHosts.has(hostUrl.hostname)) {
    throw new Error('Only a local HTTP Ollama host is supported in this phase.');
  }

  return {
    projectRoot: resolve(cwd, projectRoot),
    model: model.trim(),
    ollamaHost: hostUrl.origin,
  };
}

export class HelpRequested extends Error {}

export const HELP_TEXT = `Local Code Agent (read-only foundation)

Usage:
  npm run dev -- [--project PATH] [--model NAME] [--host URL]

Options:
  --project PATH   Project to inspect (default: current directory)
  --model NAME     Ollama model (default: qwen3:8b)
  --host URL       Local Ollama endpoint (default: http://127.0.0.1:11434)
  --help, -h       Show this help

Environment:
  CODE_AGENT_MODEL, CODE_AGENT_OLLAMA_HOST

Inside the session:
  /context  Refresh and show project metadata
  /clear    Clear conversation history
  /help     Show session commands
  /exit     Leave the session`;
