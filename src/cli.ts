import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { HELP_TEXT, HelpRequested, parseConfig } from './config.js';
import { OllamaProvider } from './providers/ollama-provider.js';
import { formatProfile, inspectProject } from './project/inspect.js';
import { ChatSession } from './session.js';
import { createProjectToolRegistry } from './tools/index.js';

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.argv.slice(2));
  } catch (error) {
    if (error instanceof HelpRequested) {
      stdout.write(`${HELP_TEXT}\n`);
      return;
    }
    throw error;
  }

  let profile = await inspectProject(config.projectRoot);
  const provider = new OllamaProvider(config.model, config.ollamaHost);
  stdout.write(`Checking Ollama at ${config.ollamaHost}...\n`);
  await provider.checkAvailability();
  stdout.write(
    `Ready with ${config.model}. Enabled tools: read_file, list_directory.\n\n`,
  );
  stdout.write(`${formatProfile(profile)}\n\n`);

  const tools = createProjectToolRegistry(config.projectRoot);
  const session = new ChatSession(provider, profile, tools);
  const rl = createInterface({ input: stdin, output: stdout });
  let activeRequest: AbortController | undefined;
  let shouldExit = false;

  rl.on('SIGINT', () => {
    if (activeRequest) {
      activeRequest.abort();
      stdout.write('\nGeneration cancelled.\n');
    } else {
      shouldExit = true;
      rl.close();
    }
  });

  stdout.write('Ask about the project, or type /help.\n');
  try {
    while (!shouldExit) {
      let input: string;
      try {
        input = (await rl.question('\nYou> ')).trim();
      } catch {
        break;
      }

      if (!input) continue;
      if (input === '/exit') break;
      if (input === '/help') {
        stdout.write(`${HELP_TEXT}\n`);
        continue;
      }
      if (input === '/context') {
        profile = await inspectProject(config.projectRoot);
        session.updateProfile(profile);
        stdout.write(`${formatProfile(profile)}\n`);
        continue;
      }
      if (input === '/clear') {
        profile = await inspectProject(config.projectRoot);
        session.reset(profile);
        stdout.write('Conversation cleared and project metadata refreshed.\n');
        continue;
      }
      if (input.startsWith('/')) {
        stdout.write('Unknown session command. Type /help.\n');
        continue;
      }

      activeRequest = new AbortController();
      stdout.write('Agent> ');
      try {
        for await (const chunk of session.reply(input, activeRequest.signal)) {
          stdout.write(chunk);
        }
        stdout.write('\n');
      } catch (error) {
        if (!activeRequest.signal.aborted) {
          stdout.write(`\nRequest failed: ${String(error)}\n`);
        }
      } finally {
        activeRequest = undefined;
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
