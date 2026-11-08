#!/usr/bin/env node
// Terminal chat. Chats are saved in the workspace folder like the web UI's.
//   npm run cli                                interactive chat in the first workspace
//   npm run cli -- --workspace "English tutor" in a workspace by name
//   npm run cli -- --new "My app" --path ~/code/my-app   create a workspace on a folder
//   npm run cli -- --model "GPT 4.1"           a model from the app's Settings -> Models
//   npm run ask -- "your prompt"               one prompt, then exit
import fs from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  BackgroundTasks,
  loadAgentConfig,
  McpHub,
  Planner,
  type AgentRunOptions,
} from '@app/agent';
import { runInChat, Store, titleFrom, type Chat } from '@app/db';
import {
  REASONING_EFFORTS,
  type AgentEvent,
  type ModelProfile,
  type ReasoningEffort,
  type RunResult,
  type Workspace,
} from '@app/shared';

// One .env at the repo root serves the API and the CLI.
const ROOT_ENV_FILE = fileURLToPath(new URL('../../../.env', import.meta.url));
if (fs.existsSync(ROOT_ENV_FILE)) process.loadEnvFile(ROOT_ENV_FILE);

const config = loadAgentConfig(process.env);

const HELP = `Commands: /plan  show the current plan   /memory  this workspace's memories
          /workspaces  list workspaces   /workspace NAME  switch workspace   /folder  workspace folder
          /models  list models   /model NAME  switch model   /effort low|medium|high|off
          /reset  start a new chat   /help   /exit`;

const isEffort = (value: string): value is ReasoningEffort =>
  (REASONING_EFFORTS as readonly string[]).includes(value);

function describeModel(model: ModelProfile, effort: ReasoningEffort | null): string {
  const server = (model.baseUrl ?? 'api.openai.com').replace(/^https?:\/\//, '');
  const thinking = model.supportsReasoning && effort ? `, ${effort} effort` : '';
  return `${model.name} (${model.model} at ${server}${thinking})`;
}

/** Prints the agent's text as it streams, and afterwards anything that wasn't streamed. */
function createPrinter() {
  let lastBlock = ''; // text since the last tool call
  let hasStreamed = false;
  let isAtLineStart = true;
  return {
    onEvent(event: AgentEvent) {
      if (event.type === 'text_delta') {
        process.stdout.write(event.text);
        lastBlock += event.text;
        hasStreamed = true;
        isAtLineStart = event.text.endsWith('\n');
      } else if (event.type === 'tool_call') {
        if (!isAtLineStart) process.stdout.write('\n');
        isAtLineStart = true;
        lastBlock = '';
      } else if (event.type === 'compaction') {
        if (!isAtLineStart) process.stdout.write('\n');
        console.log(
          `\x1b[2m(Summarized ${event.summarizedMessages} earlier messages to stay within the model's context window.)\x1b[0m`,
        );
        isAtLineStart = true;
      }
    },
    finish(result: RunResult) {
      if (!isAtLineStart) process.stdout.write('\n');
      const streamed = lastBlock.trim();
      if (!hasStreamed || result.status !== 'done') {
        // e.g. a limit was hit: print the part of the message that wasn't streamed
        const rest =
          streamed && result.text.startsWith(streamed)
            ? result.text.slice(streamed.length).trim()
            : result.text;
        if (rest) console.log(rest);
      }
      lastBlock = '';
      hasStreamed = false;
      isAtLineStart = true;
    },
  };
}

/** Removes `--name value` from args and returns the value, or null when absent. */
function takeOption(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  if (i === -1) return null;
  return args.splice(i, 2)[1] ?? '';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const workspaceName = takeOption(args, '--workspace');
  const newName = takeOption(args, '--new');
  const newPath = takeOption(args, '--path');
  const modelName = takeOption(args, '--model');
  const isOnce = args.includes('--once');
  const prompt = isOnce ? args.filter((a) => a !== '--once').join(' ') : '';

  const store = new Store();
  // The data folders were renamed with the app; move the old ones first.
  for (const note of await store.moveLegacyFolders()) console.log(note);
  // MCP servers used to be set per workspace folder; move any old ones to the app's list.
  for (const note of await store.importLegacyMcp()) console.log(note);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const printer = createPrinter();
  // The workspace's MCP servers (set up in the web app's MCP tab) work here too.
  const mcp = new McpHub();
  // Commands the agent starts in the background run until it stops them or the CLI exits.
  const tasks = new BackgroundTasks();
  const baseOptions: AgentRunOptions = {
    config,
    ask: (question) => rl.question(question),
    onEvent: printer.onEvent,
  };

  try {
    let found: Workspace | null;
    if (newName !== null) {
      if (!newPath) throw new Error('Say where the workspace lives: --new NAME --path FOLDER');
      found = await store.createWorkspace({ name: newName, path: newPath });
      console.log(`Created workspace "${found.name}" in ${found.path}`);
    } else if (workspaceName) {
      found = await store.findWorkspaceByName(workspaceName);
      if (!found) {
        const names = (await store.listWorkspaces()).map((w) => `"${w.name}"`).join(', ');
        throw new Error(`No workspace is named "${workspaceName}". Workspaces: ${names || 'none'}`);
      }
    } else {
      found = (await store.listWorkspaces())[0] ?? null;
      if (!found) {
        throw new Error(
          'There are no workspaces yet. Create one in the web app, or here with: npm run cli -- --new "My app" --path ~/code/my-app',
        );
      }
    }
    let workspace: Workspace = found;

    const pickModel = async (name: string | null): Promise<ModelProfile> => {
      const picked = name
        ? await store.models.findByName(name)
        : ((await store.models.settingsFor())?.profile ?? null);
      if (picked) return picked;
      const names = (await store.models.list()).map((m) => `"${m.name}"`).join(', ');
      throw new Error(
        name
          ? `No model is named "${name}". Models: ${names || 'none'}`
          : 'No model is set up yet. Add one in the web app under Settings → Models.',
      );
    };
    let model = await pickModel(modelName);
    let effort: ReasoningEffort | null = null;
    // The open chat: created on the first message, like in the web UI.
    const session: { chat: Chat | null } = { chat: null };

    const ask = async (text: string): Promise<RunResult> => {
      const current = session.chat ?? (await store.createChat(workspace.id, titleFrom(text)));
      const resolved = await store.models.settingsFor(model.id);
      if (!resolved) throw new Error(`"${model.name}" was deleted. Pick another with /model.`);
      const agentOptions: AgentRunOptions = {
        ...baseOptions,
        // Settings -> Agent in the web app (limits, approvals, planning), read per message.
        config: { ...config, ...(await store.settings.get()) },
        model: {
          ...resolved.settings,
          reasoningEffort: resolved.profile.supportsReasoning ? effort : null,
        },
      };
      const result = await runInChat({
        store,
        workspace,
        chat: current,
        prompt: text,
        agentOptions,
        mcp,
        tasks,
      });
      session.chat = await store.getChat(current.id); // pick up the saved plan and memory state
      return result;
    };

    if (isOnce) {
      const result = await ask(prompt);
      printer.finish(result);
      process.exitCode = result.status === 'done' ? 0 : 1;
      return;
    }

    console.log(
      `Agent ready on ${describeModel(model, effort)}, workspace "${workspace.name}" in ${workspace.path}. ${HELP}`,
    );
    while (true) {
      let input: string;
      try {
        input = (await rl.question('\nyou> ')).trim();
      } catch {
        break; // Ctrl+D / closed input
      }
      if (!input) continue;

      if (input.startsWith('/')) {
        const [command, ...rest] = input.split(' ');
        const arg = rest.join(' ').trim();
        if (command === '/exit' || command === '/quit') break;
        else if (command === '/help') console.log(HELP);
        else if (command === '/plan') {
          const planner = new Planner();
          planner.plan = session.chat?.plan ?? null;
          console.log(planner.render());
        } else if (command === '/reset') {
          session.chat = null;
          console.log("Started a new chat (this workspace's memories are kept).");
        } else if (command === '/memory') {
          const all = await store.memory(workspace).all();
          console.log(
            all.length
              ? all.map((m) => `- ${m.fact}`).join('\n')
              : 'No memories saved in this workspace yet.',
          );
        } else if (command === '/folder') {
          console.log(workspace.path);
        } else if (command === '/workspaces') {
          for (const w of await store.listWorkspaces()) {
            console.log(`${w.id === workspace.id ? '*' : ' '} ${w.name}  \x1b[2m${w.path}\x1b[0m`);
          }
        } else if (command === '/workspace' && arg) {
          const next = await store.findWorkspaceByName(arg);
          if (!next) console.log(`No workspace is named "${arg}". See /workspaces.`);
          else {
            workspace = next;
            session.chat = null;
            console.log(`Switched to "${workspace.name}" with a new chat.`);
          }
        } else if (command === '/models') {
          for (const m of await store.models.list()) {
            const mark = m.id === model.id ? '*' : ' ';
            const tags = [m.isDefault && 'default', m.supportsReasoning && 'reasoning']
              .filter(Boolean)
              .join(', ');
            console.log(`${mark} ${m.name}  \x1b[2m${m.model}${tags ? `  (${tags})` : ''}\x1b[0m`);
          }
        } else if (command === '/model' && arg) {
          try {
            model = await pickModel(arg);
            console.log(`Using ${describeModel(model, effort)}.`);
          } catch (error) {
            console.log(error instanceof Error ? error.message : String(error));
          }
        } else if (command === '/effort' && arg) {
          if (arg === 'off') effort = null;
          else if (isEffort(arg)) effort = arg;
          else {
            console.log(`Pick one of: ${REASONING_EFFORTS.join(', ')}, off.`);
            continue;
          }
          console.log(
            model.supportsReasoning
              ? `Reasoning effort: ${effort ?? "the server's default"}.`
              : `Saved, but "${model.name}" isn't marked as a reasoning model, so it's not sent.`,
          );
        } else console.log(`Unknown command. ${HELP}`);
        continue;
      }

      try {
        process.stdout.write('\nagent> ');
        const result = await ask(input);
        printer.finish(result);
        const { inputTokens, outputTokens } = result.usage;
        const steps = `${result.steps} step${result.steps === 1 ? '' : 's'}`;
        console.log(`\x1b[2m(${steps}, ${inputTokens + outputTokens} tokens)\x1b[0m`);
      } catch (error) {
        console.error(`\nError: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    rl.close();
    await mcp.close();
    await tasks.close();
  }
}

main().catch((error: unknown) => {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
