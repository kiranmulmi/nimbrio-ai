// Offline tests: no API key or network needed. The agent loop is driven by a
// fake model so the loop, tools and guardrails can be checked for free.
// Run with: npm run test -w @app/agent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {
  DEFAULT_AGENT_SETTINGS,
  attachmentKind,
  readAgentSettings,
  type AgentEvent,
  type Attachment,
  type Skill,
} from '@app/shared';
import { evaluate } from '../src/tools/calculator.js';
import { Planner, parseDecision } from '../src/planner.js';
import {
  Budget,
  checkInput,
  resolveInWorkspace,
  assertCanChange,
  prepareWorkspaceFolder,
  refuseCommand,
  commandEnv,
  assertPublicUrl,
  isPrivateAddress,
} from '../src/guardrails.js';
import { createAgent, type SteeringMessage } from '../src/agent.js';
import { readUsage } from '../src/llm.js';
import { inputBreakdown, outputBreakdown } from '../src/usage-breakdown.js';
import { loadAgentConfig } from '../src/config.js';
import { webSearch } from '../src/tools/web-search.js';
import { htmlToText } from '../src/tools/fetch-page.js';
import { listFiles } from '../src/tools/files/list-files.js';
import { listWorkspaceFiles } from '../src/tools/files/walk.js';
import { readFile } from '../src/tools/files/read-file.js';
import { findFiles } from '../src/tools/files/find-files.js';
import { searchFiles } from '../src/tools/files/search-files.js';
import { writeFile } from '../src/tools/files/write-file.js';
import { editFile } from '../src/tools/files/edit-file.js';
import { createFolder } from '../src/tools/files/create-folder.js';
import { movePath } from '../src/tools/files/move-path.js';
import { copyPath } from '../src/tools/files/copy-path.js';
import { deletePath } from '../src/tools/files/delete-path.js';
import { runCommand } from '../src/tools/run-command.js';
import { stopTask, taskOutput } from '../src/tools/tasks.js';
import { BackgroundTasks } from '../src/background-tasks.js';
import { LongTermMemory, renderMemories } from '../src/memory/long-term.js';
import { recall, forget, remember } from '../src/tools/memory.js';
import { readAttachment, saveAttachment, viewImage } from '../src/tools/attachments.js';
import type { AttachmentStore } from '../src/attachments.js';
import type { SkillStore } from '../src/skills.js';
import { useSkill } from '../src/tools/skills.js';
import { improveSkill, parseImprovedSkill } from '../src/improve-skill.js';
import { Conversation } from '../src/memory/short-term.js';
import {
  compactionCut,
  contextBudget,
  contextLimits,
  shrinkToolResults,
  textTokens,
  transcriptChunks,
} from '../src/context.js';
import { COMPACTION_PROMPT } from '../src/prompt.js';
import { cleanTitle, suggestChatTitle } from '../src/title.js';
import { cleanImprovedPrompt, improvePrompt } from '../src/improve.js';
import { writeInstructions } from '../src/write-instructions.js';
import { findFilesByName, searchFileContents } from '../src/workspace-search.js';
import { defineTool, type ToolContext } from '../src/tools/define.js';
import type { AgentLogger } from '../src/logger.js';
import type { CallModel, ModelReply, ModelRequest } from '../src/llm.js';
import type { ModelMessage, ToolCall, ToolMessage } from '../src/memory/short-term.js';

const silentLogger: AgentLogger = {
  file: null,
  event() {},
  step() {},
  warn() {},
  error() {},
};

interface TestSetup {
  /** the workspace folder */
  filesDir: string;
  longTermMemory: LongTermMemory;
  /** where longTermMemory keeps memory.json */
  dataDir: string;
}

/** A fresh workspace folder and memory file: what createAgent needs besides the model. */
async function tempSetup(): Promise<TestSetup> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-test-'));
  const filesDir = path.join(tmp, 'workspace');
  const dataDir = path.join(tmp, 'data');
  await fs.mkdir(filesDir, { recursive: true });
  return {
    filesDir,
    dataDir,
    longTermMemory: new LongTermMemory(path.join(dataDir, 'memory.json')),
  };
}

/** A full tool context; tests override only the parts a tool uses. */
function toolContext(overrides: Partial<ToolContext>): ToolContext {
  return {
    planner: new Planner(),
    longTermMemory: new LongTermMemory(path.join(os.tmpdir(), 'agent-test-unused-memory.json')),
    workspace: os.tmpdir(),
    searxngUrl: 'http://127.0.0.1:1',
    attachments: null,
    skills: null,
    loadTools: null,
    tasks: null,
    showImage: () => {},
    ...overrides,
  };
}

/** The item at `index` (negative counts from the end), failing the test when it's missing. */
function nth<T>(items: readonly T[], index: number): T {
  const item = items.at(index);
  assert.ok(item !== undefined, `no item at index ${index}`);
  return item;
}

interface Scripted {
  finishReason?: string;
  message: ModelReply;
  stream?: string[];
}

/** A fake model that returns scripted responses in order and records each request. */
function scriptedModel(responses: Scripted[]) {
  const requests: Omit<ModelRequest, 'onText'>[] = [];
  const callModel: CallModel = async (req) => {
    const { onText, ...rest } = req;
    requests.push(structuredClone(rest));
    const next = responses.shift();
    if (!next) throw new Error('fake model ran out of responses');
    for (const piece of next.stream ?? []) onText?.(piece); // simulate streamed text
    return {
      model: 'fake',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: next.finishReason ?? 'stop',
      message: next.message,
    };
  };
  return { callModel, requests };
}

// OpenAI chat-format replies.
const callTools = (...calls: ToolCall[]): Scripted => ({
  finishReason: 'tool_calls',
  message: { role: 'assistant', content: null, tool_calls: calls },
});
const toolCall = (id: string, name: string, input: unknown): ToolCall => ({
  id,
  type: 'function',
  function: { name, arguments: typeof input === 'string' ? input : JSON.stringify(input) },
});
const answer = (text: string): Scripted => ({
  finishReason: 'stop',
  message: { role: 'assistant', content: text },
});
const isToolMessage = (m: ModelMessage): m is ToolMessage => m.role === 'tool';
const toolMessages = (req: { messages: ModelMessage[] }) => req.messages.filter(isToolMessage);

test('calculator handles precedence, powers and functions', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('(2 + 3) * 4'), 20);
  assert.equal(evaluate('2 ^ 3 ^ 2'), 512);
  assert.equal(evaluate('-2 ^ 2'), -4);
  assert.equal(evaluate('sqrt(16) + abs(-3)'), 7);
  assert.ok(Math.abs(evaluate('2347912 * 0.185') - 434363.72) < 1e-6);
  assert.throws(() => evaluate('1 / 0'), /Division by zero/);
  assert.throws(() => evaluate('process.exit()'), /Unknown symbol/);
});

test('planner tracks step status', () => {
  const planner = new Planner();
  planner.create('Ship it', ['write', 'test']);
  planner.update(1, 'done', 'ok');
  assert.equal(planner.isComplete(), false);
  planner.update(2, 'done');
  assert.equal(planner.isComplete(), true);
  assert.throws(() => planner.update(3, 'done'), /doesn't exist/);
});

test('guardrails reject bad input and enforce the budget', () => {
  assert.equal(checkInput('  ', { maxInputChars: 10 }).ok, false);
  assert.equal(checkInput('x'.repeat(11), { maxInputChars: 10 }).ok, false);
  const budget = new Budget({ maxSteps: 2, maxTotalTokens: 1000 });
  budget.recordCall({ inputTokens: 10, outputTokens: 10 });
  assert.equal(budget.exceeded(), null);
  budget.recordCall({ inputTokens: 10, outputTokens: 10 });
  assert.match(budget.exceeded() ?? '', /steps/);
});

test('file paths cannot escape the workspace', async () => {
  const { filesDir: workspace } = await tempSetup();
  const root = await fs.realpath(workspace);
  await assert.rejects(resolveInWorkspace(workspace, '../secret.txt'), /outside the workspace/);
  await assert.rejects(resolveInWorkspace(workspace, '/etc/passwd'), /outside the workspace/);
  await assert.rejects(resolveInWorkspace(workspace, '~/.ssh/id_rsa'), /outside the workspace/);
  await fs.symlink(os.tmpdir(), path.join(workspace, 'link'));
  await assert.rejects(resolveInWorkspace(workspace, 'link/x.txt'), /outside the workspace/);
  assert.equal(await resolveInWorkspace(workspace, 'a/b.txt'), path.join(root, 'a/b.txt'));
  assert.equal(
    await resolveInWorkspace(workspace, path.join(workspace, 'a.txt')),
    path.join(root, 'a.txt'),
    'an absolute path inside the workspace is fine',
  );
  await assert.rejects(assertCanChange(workspace, root), /workspace folder itself/);
  await assert.rejects(assertCanChange(workspace, path.join(root, '.git', 'HEAD')), /\.git/);
  await assertCanChange(workspace, path.join(root, '.gitignore'));
});

test('a workspace folder is created when missing, but never the disk or home itself', async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-folder-')));
  assert.equal(
    await prepareWorkspaceFolder(path.join(tmp, 'new', 'app')),
    path.join(tmp, 'new', 'app'),
  );
  assert.ok((await fs.stat(path.join(tmp, 'new', 'app'))).isDirectory());
  await fs.writeFile(path.join(tmp, 'file.txt'), 'x');
  await assert.rejects(prepareWorkspaceFolder(path.join(tmp, 'file.txt')), /is a file/);
  await assert.rejects(prepareWorkspaceFolder('relative/dir'), /absolute path/);
  await assert.rejects(prepareWorkspaceFolder('/'), /not the whole disk or your home folder/);
  await assert.rejects(prepareWorkspaceFolder('~'), /not the whole disk or your home folder/);
});

/** A small project to point the file tools at. */
async function sampleProject(): Promise<ToolContext> {
  const { filesDir } = await tempSetup();
  const write = async (file: string, content: string) => {
    await fs.mkdir(path.dirname(path.join(filesDir, file)), { recursive: true });
    await fs.writeFile(path.join(filesDir, file), content);
  };
  await write('package.json', '{ "name": "demo" }');
  await write('src/index.ts', "import { add } from './math.js';\nconsole.log(add(1, 2));\n");
  await write('src/math.ts', 'export function add(a: number, b: number) {\n  return a + b;\n}\n');
  await write('src/math.test.ts', "import { add } from './math.js';\n");
  await write('node_modules/lib/index.js', 'export function add() {}');
  await write('.git/HEAD', 'ref: refs/heads/main');
  // The app's own data: never listed, searched, read or changed by file tools.
  await write('.nimbrio-ai/chats/c1/messages.jsonl', '{"content":"export function add"}\n');
  await write('.nimbrio-ai/memory.json', '[]');
  return toolContext({ workspace: filesDir });
}

test("file tools can't see or touch the app's own .nimbrio-ai data", async () => {
  const ctx = await sampleProject();
  const refused = /holds this app's own chats/;
  await assert.rejects(readFile.run({ path: '.nimbrio-ai/memory.json' }, ctx), refused);
  await assert.rejects(readFile.run({ path: '.Nimbrio-AI/memory.json' }, ctx), refused);
  await assert.rejects(listFiles.run({ path: '.nimbrio-ai' }, ctx), refused);
  // The folder's name before the app was renamed, in case an old copy is left.
  await assert.rejects(readFile.run({ path: '.agentic-ai/memory.json' }, ctx), refused);
  await assert.rejects(
    writeFile.run({ path: '.nimbrio-ai/memory.json', content: '[]' }, ctx),
    refused,
  );
  await assert.rejects(deletePath.run({ path: '.nimbrio-ai' }, ctx), refused);
  await assert.rejects(
    movePath.run({ from: 'package.json', to: 'sub/.nimbrio-ai/x.json' }, ctx),
    refused,
  );
  assert.match(String(await findFiles.run({ pattern: '*.json*' }, ctx)), /^package\.json$/);
});

test('list_files shows a tree and leaves generated folders closed', async () => {
  const ctx = await sampleProject();
  assert.equal(
    await listFiles.run({}, ctx),
    [
      './',
      '.git/ (not opened)',
      'node_modules/ (not opened)',
      'package.json',
      'src/',
      '  index.ts',
      '  math.test.ts',
      '  math.ts',
    ].join('\n'),
  );
  assert.equal(
    await listFiles.run({ path: 'src', depth: 1 }, ctx),
    'src/\nindex.ts\nmath.test.ts\nmath.ts',
  );
});

test('read_file reads whole files or line ranges', async () => {
  const ctx = await sampleProject();
  assert.equal(await readFile.run({ path: 'package.json' }, ctx), '{ "name": "demo" }');
  assert.equal(
    await readFile.run({ path: 'src/math.ts', start_line: 2, end_line: 2 }, ctx),
    '[src/math.ts: lines 2-2 of 4. Continue with start_line 3.]\n  return a + b;',
  );
  await assert.rejects(readFile.run({ path: 'src' }, ctx), /is a folder/);
});

test('find_files and search_files skip generated folders', async () => {
  const ctx = await sampleProject();
  assert.equal(
    await findFiles.run({ pattern: '*.ts' }, ctx),
    'src/index.ts\nsrc/math.test.ts\nsrc/math.ts',
  );
  assert.equal(await findFiles.run({ pattern: 'src/*.test.ts' }, ctx), 'src/math.test.ts');
  assert.equal(await findFiles.run({ pattern: '*.{json,js}' }, ctx), 'package.json');
  assert.equal(
    await searchFiles.run({ query: 'function add' }, ctx),
    'src/math.ts:1: export function add(a: number, b: number) {',
  );
  assert.equal(
    await searchFiles.run({ query: 'add\\(\\d', is_regex: true, glob: '*.ts' }, ctx),
    'src/index.ts:2: console.log(add(1, 2));',
  );
  assert.match(String(await searchFiles.run({ query: 'nothing-here' }, ctx)), /No matches/);
});

test('edit_file replaces exactly one match unless told otherwise', async () => {
  const ctx = await sampleProject();
  const file = path.join(ctx.workspace, 'src/math.ts');
  await editFile.run({ path: 'src/math.ts', old_text: 'a + b', new_text: 'a + b + 0' }, ctx);
  assert.match(await fs.readFile(file, 'utf8'), /return a \+ b \+ 0;/);
  await assert.rejects(
    editFile.run({ path: 'src/math.ts', old_text: 'missing', new_text: 'x' }, ctx),
    /not found/,
  );
  await assert.rejects(
    editFile.run({ path: 'src/math.ts', old_text: 'number', new_text: 'bigint' }, ctx),
    /occurs 2 times/,
  );
  await editFile.run(
    { path: 'src/math.ts', old_text: 'number', new_text: 'bigint', replace_all: true },
    ctx,
  );
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /number/);

  await fs.writeFile(file, 'one\r\ntwo\r\n');
  await editFile.run({ path: 'src/math.ts', old_text: 'one\ntwo', new_text: 'uno\ndos' }, ctx);
  assert.equal(await fs.readFile(file, 'utf8'), 'uno\r\ndos\r\n', 'keeps Windows line endings');
});

test('write, create, move, copy and delete stay inside the workspace', async () => {
  const ctx = await sampleProject();
  const at = (file: string) => path.join(ctx.workspace, file);
  assert.match(
    String(await writeFile.run({ path: 'docs/a.md', content: '# A' }, ctx)),
    /^Created docs\/a\.md/,
  );
  assert.match(
    String(await writeFile.run({ path: 'docs/a.md', content: '# B' }, ctx)),
    /^Replaced/,
  );
  await createFolder.run({ path: 'empty/inner' }, ctx);
  assert.ok((await fs.stat(at('empty/inner'))).isDirectory());

  await movePath.run({ from: 'docs/a.md', to: 'docs/b.md' }, ctx);
  await assert.rejects(fs.access(at('docs/a.md')));
  await assert.rejects(movePath.run({ from: 'src', to: 'src/inner' }, ctx), /into itself/);
  await assert.rejects(
    movePath.run({ from: 'docs/b.md', to: 'package.json' }, ctx),
    /already exists/,
  );

  await copyPath.run({ from: 'src', to: 'src-copy' }, ctx);
  assert.equal(
    await fs.readFile(at('src-copy/math.ts'), 'utf8'),
    await fs.readFile(at('src/math.ts'), 'utf8'),
  );

  await assert.rejects(deletePath.run({ path: 'src-copy' }, ctx), /recursive/);
  await deletePath.run({ path: 'src-copy', recursive: true }, ctx);
  await assert.rejects(fs.access(at('src-copy')));
  await deletePath.run({ path: 'empty/inner' }, ctx);

  await assert.rejects(
    deletePath.run({ path: '.', recursive: true }, ctx),
    /workspace folder itself/,
  );
  await assert.rejects(writeFile.run({ path: '.git/config', content: '' }, ctx), /\.git/);
  await assert.rejects(writeFile.run({ path: '../escape.txt', content: '' }, ctx), /outside/);
  await assert.rejects(copyPath.run({ from: 'src', to: '/tmp/escape' }, ctx), /outside/);
});

test('every file tool that changes something asks first; reads never do', () => {
  const changes = [
    writeFile,
    editFile,
    createFolder,
    movePath,
    copyPath,
    deletePath,
    runCommand,
    stopTask,
  ];
  for (const tool of changes) assert.equal(tool.needsApproval, true, tool.name);
  for (const tool of [listFiles, readFile, findFiles, searchFiles, taskOutput]) {
    assert.equal(tool.needsApproval, false, tool.name);
  }
});

const hasBash = process.platform !== 'win32';

test(
  'run_command runs bash in the workspace and reports the exit code',
  { skip: !hasBash },
  async () => {
    const ctx = await sampleProject();
    const root = await fs.realpath(ctx.workspace);
    const ok = String(await runCommand.run({ command: 'pwd; echo oops >&2' }, ctx));
    assert.match(ok, /^\$ pwd; echo oops >&2\nexit code 0 · \d+\.\ds\n\n/);
    assert.ok(ok.includes(`${root}\noops`), 'stdout and stderr together, run in the workspace');

    assert.match(
      String(await runCommand.run({ command: 'exit 3' }, ctx)),
      /exit code 3[\s\S]*\(no output\)/,
    );
    const inSrc = String(await runCommand.run({ command: 'ls', cwd: 'src' }, ctx));
    assert.match(inSrc, /^\$ ls \(in src\/\)/);
    assert.match(inSrc, /math\.ts/);
    await assert.rejects(runCommand.run({ command: 'ls', cwd: '..' }, ctx), /outside/);
    await assert.rejects(runCommand.run({ command: 'sudo ls' }, ctx), /another user[\s\S]*not run/);
  },
);

test(
  'run_command stops at the timeout and stops what a command leaves running',
  { skip: !hasBash },
  async () => {
    const ctx = await sampleProject();
    let started = Date.now();
    const slow = String(await runCommand.run({ command: 'sleep 30', timeout_seconds: 1 }, ctx));
    assert.match(slow, /stopped after 1s \(timeout\)/);
    assert.ok(Date.now() - started < 6000);

    started = Date.now();
    const background = String(
      await runCommand.run({ command: 'sleep 31 & echo $! > bg.pid; echo started' }, ctx),
    );
    assert.match(background, /exit code 0[\s\S]*started/);
    assert.ok(Date.now() - started < 6000, "doesn't wait for the background process");
    const pid = Number((await fs.readFile(path.join(ctx.workspace, 'bg.pid'), 'utf8')).trim());
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the background process was stopped');
  },
);

test(
  'run_command background keeps a command running as a task that can be read and stopped',
  { skip: !hasBash },
  async () => {
    const base = await sampleProject();
    const registry = new BackgroundTasks();
    const ctx = { ...base, tasks: registry.forWorkspace(base.workspace, 'chat-1') };
    try {
      const started = Date.now();
      const reply = String(
        await runCommand.run(
          { command: 'echo booting; sleep 33 & echo $! > child.pid; wait', background: true },
          ctx,
        ),
      );
      assert.ok(Date.now() - started < 8000, 'returns after the startup wait');
      const id = /as task (\w+)/.exec(reply)?.[1] ?? '';
      assert.ok(id, `a task id in: ${reply}`);
      assert.match(reply, /booting/, 'the first output comes back');

      const [listed] = registry.list(base.workspace);
      assert.equal(listed?.isRunning, true);
      assert.equal(listed?.chatId, 'chat-1');
      assert.equal(registry.list('/some/other/workspace').length, 0, 'other workspaces see none');
      assert.match(String(await taskOutput.run({}, ctx)), new RegExp(`${id}: \\$ echo booting`));
      assert.match(
        String(await taskOutput.run({ task_id: id }, ctx)),
        /running since[\s\S]*booting/,
      );

      const child = Number(
        (await fs.readFile(path.join(base.workspace, 'child.pid'), 'utf8')).trim(),
      );
      assert.match(String(await stopTask.run({ task_id: id }, ctx)), /Stopped task/);
      assert.equal(registry.get(base.workspace, id)?.isRunning, false);
      assert.throws(() => process.kill(child, 0), /ESRCH/, 'what it started was stopped too');

      const quick = String(await runCommand.run({ command: 'exit 4', background: true }, ctx));
      assert.match(quick, /already stopped: exit code 4/);
      await assert.rejects(
        runCommand.run({ command: 'sleep 1', background: true }, base),
        /aren't available/,
      );
    } finally {
      await registry.close();
    }
  },
);

test(
  "commands don't see the app's secrets and can't wait for input",
  { skip: !hasBash },
  async () => {
    const ctx = await sampleProject();
    process.env.OPENAI_API_KEY = 'sk-should-not-leak';
    try {
      const out = String(
        await runCommand.run(
          { command: 'echo "key=${OPENAI_API_KEY:-none} ci=$CI"; read line; echo "read=$?"' },
          ctx,
        ),
      );
      assert.match(out, /key=none ci=true\nread=1/);
    } finally {
      delete process.env.OPENAI_API_KEY;
    }
    const env = commandEnv({
      PATH: '/bin',
      HOME: '/h',
      DATABASE_URL: 'x',
      EVAL_API_KEY: 'sk-eval',
      npm_config_cache: 'y',
      PORT: '3000',
      SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_ANON_KEY: 'anon',
      AUTH_ALLOWED_EMAILS: 'me@example.com',
      SIGN_IN: 'off',
      SIGN_IN_REQUIRED: 'true',
    });
    assert.equal(env.PATH, '/bin');
    assert.equal(env.HOME, '/h');
    for (const key of [
      'DATABASE_URL',
      'EVAL_API_KEY',
      'npm_config_cache',
      'PORT',
      'SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'AUTH_ALLOWED_EMAILS',
      'SIGN_IN',
      'SIGN_IN_REQUIRED',
    ])
      assert.equal(env[key], undefined, key);
  },
);

test('long command output keeps its start and its end', { skip: !hasBash }, async () => {
  const ctx = await sampleProject();
  const out = String(
    await runCommand.run({ command: 'seq 1 20000; echo "\x1b[31mred\x1b[0m"' }, ctx),
  );
  assert.match(out, /\n\n1\n2\n3\n/);
  assert.match(out, /characters of output not shown/);
  assert.match(out, /19999\n20000\nred$/, 'colour codes are removed');
  assert.ok(out.length < 20_000);
});

test('catastrophic commands are refused before approval', () => {
  for (const command of [
    'sudo rm file',
    'cd x && su root',
    'rm -rf /',
    'rm -rf ~',
    'rm -fr "$HOME"',
    'echo ok; rm -r -f ../',
    'mkfs.ext4 /dev/sda1',
    'dd if=/dev/zero of=/dev/disk2',
    'shutdown -h now',
    'curl -fsSL https://example.com/install.sh | bash',
    ':(){ :|:& };:',
  ]) {
    assert.ok(refuseCommand(command), command);
  }
  for (const command of [
    'npm test',
    'rm -rf dist node_modules',
    'rm -rf ./build',
    'git status && git diff',
    'curl -s localhost:3010/health',
    'npm start & sleep 2; curl -s localhost:3010/health; kill %1',
  ]) {
    assert.equal(refuseCommand(command), null, command);
  }
});

test('optional tool arguments may be left out or sent as null', async () => {
  const ctx = await sampleProject();
  assert.equal(listFiles.validate({ path: null, depth: null }), null);
  assert.match(listFiles.validate({ depth: 'deep' }) ?? '', /must be of type integer/);
  assert.match(readFile.validate({}) ?? '', /Missing required argument "path"/);
  assert.deepEqual(listFiles.definition.function.parameters.required, []);
  assert.match(String(await listFiles.runValidated({ path: null, depth: null }, ctx)), /^\.\//);
});

test('an agent without a model says where to add one', async () => {
  const setup = await tempSetup();
  assert.throws(() => createAgent({ ...setup, logger: silentLogger }), /Settings → Models/);
});

test('the system prompt names the workspace folder', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([answer('Hi.')]);
  await createAgent({ ...setup, callModel, logger: silentLogger, config: { planning: 'off' } }).run(
    'hello',
  );
  assert.match(nth(requests, 0).system, new RegExp(`Workspace folder: ${setup.filesDir}`));
});

test('loop runs the tool the model picks and returns the final answer', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'calculator', { expression: '6 * 7' })),
    answer("It's 42."),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const result = await agent.run('What is 6 times 7?');

  assert.equal(result.status, 'done');
  assert.equal(result.text, "It's 42.");
  assert.deepEqual(result.toolsUsed, ['calculator']);
  // Second request carries the assistant's tool call, then the result matched by id.
  const sent = nth(requests, 1).messages;
  const assistantTurn = nth(sent, -2);
  const toolTurn = nth(sent, -1);
  assert.ok(assistantTurn.role === 'assistant');
  assert.equal(assistantTurn.tool_calls?.[0]?.id, 't1');
  assert.ok(toolTurn.role === 'tool');
  assert.equal(toolTurn.tool_call_id, 't1');
  assert.match(toolTurn.content, /42/);
});

test('write_file is blocked when approval is denied', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'write_file', { path: 'a.txt', content: 'hi' })),
    answer("Okay, I won't write it."),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off', approval: 'deny' },
  });
  await agent.run('Save hi to a.txt');

  assert.match(nth(toolMessages(nth(requests, 1)), 0).content, /^Error: The user did not approve/);
  await assert.rejects(fs.access(path.join(setup.filesDir, 'a.txt')));
});

test('loop stops at the step limit', async () => {
  const setup = await tempSetup();
  const loopForever = Array.from({ length: 5 }, (_, i) =>
    callTools(toolCall(`t${i}`, 'get_current_time', { timezone: 'UTC' })),
  );
  const { callModel } = scriptedModel(loopForever);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off', maxSteps: 3 },
  });
  const result = await agent.run('loop');
  assert.equal(result.status, 'budget_exceeded');
  assert.equal(result.steps, 4, '3 working steps + 1 write-up call');
});

test('memory saved in one session is recalled in the next', async () => {
  const setup = await tempSetup();
  const first = scriptedModel([
    callTools(
      toolCall('t1', 'remember', { fact: "The user's favourite language is Rust.", replaces: '' }),
    ),
    answer('Noted.'),
  ]);
  await createAgent({
    ...setup,
    callModel: first.callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  }).run('I love Rust');

  const second = scriptedModel([
    callTools(toolCall('t1', 'recall', { query: 'favourite language' })),
    answer('Rust.'),
  ]);
  await createAgent({
    ...setup,
    callModel: second.callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  }).run('What do I like?');
  assert.match(nth(toolMessages(nth(second.requests, 1)), 0).content, /Rust/);
});

test('bad tool arguments come back as errors the model can fix', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(
      toolCall('t1', 'calculator', '{not json'),
      toolCall('t2', 'calculator', { expr: '1+1' }),
      toolCall('t3', 'update_plan', { step_number: 1, status: 'finished', note: '' }),
      toolCall('t4', 'no_such_tool', {}),
    ),
    answer('Sorry.'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('break things');

  const results = toolMessages(nth(requests, 1)).map((m) => m.content);
  assert.equal(results.length, 4, 'every tool call gets a result');
  assert.match(nth(results, 0), /not valid JSON/);
  assert.match(nth(results, 1), /Missing required argument "expression"/);
  assert.match(nth(results, 2), /must be one of/);
  assert.match(nth(results, 3), /no tool named/);
});

test('tool calls are run even when the server reports finish_reason stop', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([
    { ...callTools(toolCall('t1', 'calculator', { expression: '2+2' })), finishReason: 'stop' },
    answer('4'),
  ]);
  const result = await createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  }).run('2+2?');
  assert.deepEqual(result.toolsUsed, ['calculator']);
  assert.equal(result.text, '4');
});

test('web_search queries SearXNG and formats the results', async () => {
  const seen: { url?: URL } = {};
  const fake = http.createServer((req, res) => {
    seen.url = new URL(req.url ?? '/', 'http://x');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify({
        results: [
          {
            title: 'Nepal PM',
            url: 'https://example.org/pm',
            content: 'The prime  minister is ...',
            publishedDate: '2026-05-01T00:00:00',
          },
        ],
        answers: [],
        infoboxes: [],
        suggestions: ['nepal cabinet'],
      }),
    );
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  try {
    const address = fake.address();
    assert.ok(address !== null && typeof address === 'object');
    const searxngUrl = `http://127.0.0.1:${address.port}`;
    const out = await webSearch.run(
      { query: 'pm of nepal', category: 'news', time_range: 'month' },
      toolContext({ searxngUrl }),
    );
    assert.ok(seen.url);
    assert.equal(seen.url.pathname, '/search');
    assert.equal(seen.url.searchParams.get('format'), 'json');
    assert.equal(seen.url.searchParams.get('categories'), 'news');
    assert.equal(seen.url.searchParams.get('time_range'), 'month');
    assert.equal(typeof out, 'string');
    assert.match(
      String(out),
      /1\. Nepal PM\n {3}https:\/\/example.org\/pm\n {3}published: 2026-05-01\n {3}The prime minister is/,
    );
    assert.match(String(out), /Related searches: nepal cabinet/);
  } finally {
    fake.close();
  }
  await assert.rejects(
    webSearch.run(
      { query: 'x', category: 'general', time_range: 'any' },
      toolContext({ searxngUrl: 'http://127.0.0.1:1' }),
    ),
    /Could not reach SearXNG/,
  );
});

test('streamed text is passed on as text_delta events in order', async () => {
  const setup = await tempSetup();
  const events: AgentEvent[] = [];
  const { callModel } = scriptedModel([
    {
      ...callTools(toolCall('t1', 'calculator', { expression: '2+2' })),
      stream: ['Let me ', 'check.'],
    },
    { ...answer('It is 4.'), stream: ['It is ', '4.'] },
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
    onEvent: (e) => events.push(e),
  });
  const result = await agent.run('2+2?');
  assert.equal(result.text, 'It is 4.');
  const order = events.map((e) => (e.type === 'text_delta' ? `text:${e.text}` : e.type));
  assert.deepEqual(order, [
    'model_call',
    'text:Let me ',
    'text:check.',
    'context',
    'tool_call',
    'tool_result',
    'model_call',
    'text:It is ',
    'text:4.',
    'context',
  ]);
});

// ---------- Planning, checking and limits ----------

const plannerReply = (obj: object): Scripted => answer(JSON.stringify(obj));

test('planner can choose to answer directly', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    plannerReply({ mode: 'direct', reason: 'Simple greeting.' }),
    answer('Hi there!'),
  ]);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: {},
    onEvent: (e) => events.push(e),
  });
  const result = await agent.run('hello');
  assert.equal(result.text, 'Hi there!');
  assert.equal(result.steps, 2, 'planning call + answer');
  assert.equal(agent.planner.plan, null);
  assert.ok(!nth(requests, 0).tools?.length, 'the planning call has no tools');
  assert.deepEqual(
    nth(requests, 1).messages.map((m) => m.role),
    ['user'],
    'no plan injected',
  );
  const route = events.find((e) => e.type === 'route');
  assert.ok(route?.type === 'route');
  assert.equal(route.mode, 'direct');
});

test('planner plan is injected as a create_plan step, and open steps trigger one check', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    plannerReply({
      mode: 'plan',
      reason: 'Multi-part research.',
      goal: 'List X',
      steps: ['Find X', 'Find Y'],
      done_when: 'Both listed',
    }),
    callTools(toolCall('t1', 'update_plan', { step_number: 1, status: 'done', note: 'found' })),
    answer('Here is X: a long and detailed answer about X.'), // step 2 still open -> check
    callTools(
      toolCall('t2', 'update_plan', { step_number: 2, status: 'skipped', note: 'no source' }),
    ),
    answer("Y couldn't be found."),
  ]);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: {},
    onEvent: (e) => events.push(e),
  });
  const result = await agent.run('list x and y');

  assert.equal(
    result.text,
    "Here is X: a long and detailed answer about X.\n\nY couldn't be found.",
    'a short reply after the check is an addendum',
  );
  assert.deepEqual(result.toolsUsed, ['create_plan', 'update_plan', 'update_plan']);
  const firstExec = nth(requests, 1).messages;
  const planTurn = nth(firstExec, 1);
  assert.ok(planTurn.role === 'assistant');
  assert.equal(planTurn.tool_calls?.[0]?.function.name, 'create_plan');
  assert.match(nth(firstExec, 2).content, /Done when: Both listed/);
  const checkMsg = nth(nth(requests, 3).messages, -1);
  assert.match(checkMsg.content, /^\[Automatic check/);
  assert.match(checkMsg.content, /2\. Find Y \(pending\)/);
  const checkIndex = agent.conversation.messages.findIndex((m) => m.content === checkMsg.content);
  assert.ok(
    agent.conversation.isInternal(checkIndex),
    'the check message is hidden from the chat UI',
  );
  assert.deepEqual(events.filter((e) => e.type === 'check').length, 1);
  assert.equal(agent.planner.isComplete(), true);
});

test('the check runs at most once per request', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([
    plannerReply({ mode: 'plan', reason: '', goal: 'G', steps: ['A', 'B'], done_when: '' }),
    answer('First try, which is a reasonably long answer.'),
    answer('Nothing new.'),
  ]);
  const result = await createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: {},
  }).run('do it');
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'First try, which is a reasonably long answer.\n\nNothing new.');
});

test('hitting the step limit writes up the findings with a tool-free call', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'calculator', { expression: '1+1' })),
    callTools(toolCall('t2', 'calculator', { expression: '2+2' })),
    answer('So far: 1+1=2 and 2+2=4. Not finished: the rest.'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off', maxSteps: 2 },
  });
  const result = await agent.run('add lots of numbers');
  assert.equal(result.status, 'budget_exceeded');
  assert.match(result.text, /So far: 1\+1=2/);
  const summaryRequest = nth(requests, 2);
  assert.ok(!summaryRequest.tools?.length, 'the write-up call has no tools');
  assert.match(nth(summaryRequest.messages, 0).content, /Result: \{[\s\S]*"result": 4/);
});

test('planner replies are parsed defensively', () => {
  assert.equal(parseDecision('not json at all').mode, 'direct');
  assert.equal(
    parseDecision('```json\n{"mode":"plan","goal":"G","steps":["a"],"done_when":"d"}\n```').mode,
    'plan',
  );
  assert.equal(
    parseDecision('{"mode":"plan","goal":"G","steps":[]}').mode,
    'direct',
    'a plan with no steps is not a plan',
  );
  assert.equal(
    parseDecision('{"mode":"plan","goal":"","steps":["a"]}').mode,
    'direct',
    'a plan needs a goal',
  );
});

test('planner steps sent as objects keep their text, never "[object Object]"', () => {
  const decision = parseDecision(
    JSON.stringify({
      mode: 'plan',
      goal: 'Commit the changes',
      steps: [
        { step: 1, description: 'Check git status' },
        { title: 'Review the diff' },
        'Commit',
        { id: 4, done: false },
        42,
      ],
    }),
  );
  assert.equal(decision.mode, 'plan');
  if (decision.mode === 'plan') {
    assert.deepEqual(decision.steps, ['Check git status', 'Review the diff', 'Commit']);
  }
});

test('fetch_page only opens public addresses', async () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '192.168.1.1',
    '172.20.0.1',
    '169.254.169.254',
    '::1',
    'fd00::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  await assert.rejects(assertPublicUrl('http://localhost:20128/v1'), /Local and private/);
  await assert.rejects(assertPublicUrl('http://127.0.0.1:8080/'), /Local and private/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /Only http/);
  await assert.rejects(assertPublicUrl('http://user:pw@example.com/'), /credentials/);
});

test('htmlToText keeps structure and drops scripts and navigation', () => {
  const html = `<html><head><title>T</title><style>.x{}</style></head><body><nav>Menu</nav>
    <h2>Subsidiaries</h2><ul><li>Gramedia &amp; Co</li><li>Kompas TV</li></ul>
    <table><tr><td>A</td><td>B</td></tr></table><script>alert(1)</script><p>Bye&nbsp;now &#8212; ok</p></body></html>`;
  const text = htmlToText(html);
  assert.match(text, /## Subsidiaries\n+- Gramedia & Co\n- Kompas TV/);
  assert.match(text, /A \| B \|/);
  assert.match(text, /Bye now — ok/);
  assert.doesNotMatch(text, /Menu|alert|\.x\{/);
});

test('after a check that leads to new research, the new answer replaces the old one', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([
    plannerReply({ mode: 'plan', reason: '', goal: 'G', steps: ['A'], done_when: '' }),
    answer('Draft answer.'),
    callTools(
      toolCall('t1', 'calculator', { expression: '2+2' }),
      toolCall('t2', 'update_plan', { step_number: 1, status: 'done', note: '' }),
    ),
    answer('Full answer: 4.'),
  ]);
  const result = await createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: {},
  }).run('do it');
  assert.equal(result.text, 'Full answer: 4.');
});

test('forget deletes chosen facts or everything, and recall shows ids', async () => {
  const setup = await tempSetup();
  const memory = new LongTermMemory(path.join(setup.dataDir, 'memory.json'));
  const ctx = toolContext({ longTermMemory: memory });
  const a = await memory.add('The user prefers short answers.');
  await memory.add('The user works at UBA Solutions.');

  const listed = String(await recall.run({ query: '' }, ctx));
  assert.match(listed, /All saved memories \(2\)/);
  assert.match(listed, new RegExp(`\\[id ${a.id.slice(0, 8)}\\] The user prefers short answers`));

  assert.match(
    String(await forget.run({ ids: [a.id.slice(0, 8)], all: false }, ctx)),
    /Deleted 1 fact:\n- The user prefers short answers/,
  );
  assert.equal((await memory.all()).length, 1);
  assert.match(
    String(await forget.run({ ids: ['zzzzzzzz'], all: false }, ctx)),
    /No saved facts matched/,
  );
  assert.equal(
    (await memory.remove(['abc'])).length,
    0,
    'ids shorter than 8 characters never match',
  );
  assert.match(String(await forget.run({ ids: [], all: true }, ctx)), /Deleted 1 fact/);
  assert.equal(await recall.run({ query: '' }, ctx), 'Memory is empty.');
  assert.equal(forget.needsApproval, true, 'deleting memories asks the user first');
});

test('saved memories reach the model and the planner at the start of a chat', async () => {
  const setup = await tempSetup();
  const memory = new LongTermMemory(path.join(setup.dataDir, 'memory.json'));
  await memory.add("Act as the user's English tutor and gently correct their mistakes.");

  const { callModel, requests } = scriptedModel([
    plannerReply({ mode: 'direct', reason: 'Greeting.' }),
    answer('Hello! Small tip: write "hello?" as "Hello?"'),
    plannerReply({ mode: 'direct', reason: 'Chat.' }),
    answer('Sure.'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'auto' },
  });
  await agent.run('hello?');
  assert.match(
    nth(nth(requests, 0).messages, 0).content,
    /Saved memories about the user[\s\S]*English tutor/,
    'the planner sees memories',
  );
  const first = nth(nth(requests, 1).messages, 0).content;
  assert.match(
    first,
    /^\[Saved memories from earlier sessions[\s\S]*English tutor[\s\S]*\n\nhello\?$/,
  );

  await agent.run('thanks');
  const users = nth(requests, 3).messages.filter((m) => m.role === 'user');
  assert.equal(nth(users, 1).content, 'thanks', "unchanged memories aren't sent again");
  assert.equal(nth(users, 0).content, first, 'earlier turns stay as they were');
  assert.deepEqual(
    agent.conversation
      .visible()
      .filter((m) => m.role === 'user')
      .map((m) => m.content),
    ['hello?', 'thanks'],
    'the chat shows what the user typed',
  );
});

test("memories changed outside the chat are sent again; the agent's own changes are not", async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(
      toolCall('t1', 'remember', { fact: 'The user prefers short answers.', replaces: '' }),
    ),
    answer('Noted.'),
    answer('Hi.'),
    answer('Hi again.'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('I prefer short answers');
  assert.doesNotMatch(
    nth(nth(requests, 0).messages, 0).content,
    /Saved memories/,
    'an empty memory adds nothing',
  );

  await agent.run('hi');
  assert.equal(
    nth(nth(requests, 2).messages, -1).content,
    'hi',
    'the model already knows what it saved',
  );

  await agent.longTermMemory.clear(); // e.g. "Clear all" in the Memory panel
  await agent.run('hi');
  assert.match(
    nth(nth(requests, 3).messages, -1).content,
    /^\[Saved memories changed outside this chat[\s\S]*Memory is now empty[\s\S]*\n\nhi$/,
  );
});

test('remember can update a saved memory instead of adding a near-copy', async () => {
  const setup = await tempSetup();
  const memory = new LongTermMemory(path.join(setup.dataDir, 'memory.json'));
  const ctx = toolContext({ longTermMemory: memory });
  const a = await memory.add('The user wants English tutoring.');
  const id = a.id.slice(0, 8);

  assert.match(
    String(
      await remember.run(
        { fact: 'The user wants English tutoring with gentle corrections.', replaces: id },
        ctx,
      ),
    ),
    /Updated memory/,
  );
  const all = await memory.all();
  assert.equal(all.length, 1);
  assert.equal(nth(all, 0).id, a.id, 'the id is kept');
  assert.ok(nth(all, 0).updatedAt);
  await assert.rejects(
    remember.run({ fact: 'x', replaces: 'zzzzzzzz' }, ctx),
    /No saved memory has the id/,
  );
  assert.equal(
    renderMemories(all),
    `- [id ${id}] The user wants English tutoring with gentle corrections.`,
  );
  assert.match(renderMemories(all.concat(all, all), { max: 2 }), /^\(1 older memories not shown/);
});

test('config reads only the bootstrap values from env; saved settings fall back per field', async () => {
  const config = loadAgentConfig({
    AGENT_MAX_STEPS: '5',
    AGENT_APPROVAL: 'auto',
    AGENT_LOG_DIR: '~/agent-logs',
  });
  // Behaviour is set in the app now, so these env values are ignored.
  assert.equal(config.maxSteps, DEFAULT_AGENT_SETTINGS.maxSteps);
  assert.equal(config.approval, 'ask');
  assert.equal(config.logDir, path.join(os.homedir(), 'agent-logs'));
  assert.equal(loadAgentConfig({}).logDir, path.join(os.homedir(), '.nimbrio-ai', 'logs'));

  const saved = readAgentSettings({
    maxSteps: 'lots',
    approval: 'maybe',
    planning: 'off',
    maxInputChars: 500,
    searxngUrl: 'http://search.local/',
  });
  assert.equal(saved.maxSteps, 30);
  assert.equal(saved.approval, 'ask');
  assert.equal(saved.planning, 'off');
  assert.equal(saved.maxInputChars, 500);
  assert.equal(saved.searxngUrl, 'http://search.local');
  assert.deepEqual(readAgentSettings(null), DEFAULT_AGENT_SETTINGS);
});

// ---------- Attachments ----------

const fixture = (name: string) => fs.readFile(new URL(`./fixtures/${name}`, import.meta.url));

/** An in-memory attachment store holding the given files, with ids a1, a2, ... as UUIDs. */
function attachmentStore(files: { name: string; bytes: Buffer }[]): {
  store: AttachmentStore;
  attachments: Attachment[];
} {
  const attachments = files.map(({ name, bytes }, index): Attachment => ({
    id: `00000000-0000-4000-8000-00000000000${index + 1}`,
    name,
    type: '',
    size: bytes.length,
    kind: attachmentKind(name, ''),
    createdAt: new Date(0).toISOString(),
  }));
  const bytesById = new Map(attachments.map((a, index) => [a.id, nth(files, index).bytes]));
  return {
    attachments,
    store: {
      get: async (id) => attachments.find((a) => a.id === id) ?? null,
      read: async (id) => {
        const bytes = bytesById.get(id);
        if (!bytes) throw new Error('missing');
        return bytes;
      },
    },
  };
}

// A 1x1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64',
);

test('read_attachment reads PDF pages, Word documents and text files', async () => {
  const { store, attachments } = attachmentStore([
    { name: 'report.pdf', bytes: await fixture('sample.pdf') },
    { name: 'notes.docx', bytes: await fixture('sample.docx') },
    { name: 'data.csv', bytes: Buffer.from('a,b\n1,2\n') },
    { name: 'logo.png', bytes: PNG },
  ]);
  const [pdf, docx, csv, png] = attachments.map((a) => a.id);
  const ctx = toolContext({ attachments: store });

  const pages = String(await readAttachment.run({ attachment_id: pdf ?? '' }, ctx));
  assert.match(pages, /pages 1-2 of 2/);
  assert.match(pages, /--- Page 1 ---\nQuarterly revenue grew 12 percent/);
  assert.match(pages, /--- Page 2 ---\nPage two mentions the Oslo office/);
  const second = String(await readAttachment.run({ attachment_id: pdf ?? '', start_page: 2 }, ctx));
  assert.doesNotMatch(second, /Quarterly/);

  const doc = String(await readAttachment.run({ attachment_id: docx ?? '' }, ctx));
  assert.match(doc, /Meeting notes/);
  assert.match(doc, /Ship the beta on Friday\./);

  assert.equal(await readAttachment.run({ attachment_id: csv ?? '' }, ctx), 'a,b\n1,2\n');
  await assert.rejects(readAttachment.run({ attachment_id: png ?? '' }, ctx), /view_image/);
  await assert.rejects(readAttachment.run({ attachment_id: 'nope' }, ctx), /no attachment with id/);
});

test('save_attachment copies a file into the workspace and never overwrites', async () => {
  const setup = await tempSetup();
  const { store, attachments } = attachmentStore([{ name: 'logo.png', bytes: PNG }]);
  const id = nth(attachments, 0).id;
  const ctx = toolContext({ workspace: setup.filesDir, attachments: store });

  assert.equal(saveAttachment.needsApproval, true);
  await saveAttachment.run({ attachment_id: id, path: 'public/logo.png' }, ctx);
  assert.deepEqual(await fs.readFile(path.join(setup.filesDir, 'public', 'logo.png')), PNG);
  await assert.rejects(
    saveAttachment.run({ attachment_id: id, path: 'public/logo.png' }, ctx),
    /already exists/,
  );
  await assert.rejects(saveAttachment.run({ attachment_id: id, path: '.nimbrio-ai/x.png' }, ctx));
});

test('attached files are listed for the model and view_image shows the image next', async () => {
  const setup = await tempSetup();
  const { store, attachments } = attachmentStore([{ name: 'screen.png', bytes: PNG }]);
  const id = nth(attachments, 0).id;
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'view_image', { attachment_id: id })),
    answer('A single pixel.'),
  ]);
  const agent = createAgent({
    ...setup,
    attachments: store,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  // Files alone are a message too.
  const result = await agent.run('', { attachments });
  assert.equal(result.status, 'done');

  const first = nth(nth(requests, 0).messages, -1);
  assert.ok(first.role === 'user');
  assert.match(first.content, /"screen\.png" \(image, 70 B\) attachment_id: 00000000-/);

  // After the tool result: a user message that carries the image, and its data URL.
  const second = nth(requests, 1);
  const shown = nth(second.messages, -1);
  assert.ok(shown.role === 'user');
  assert.deepEqual(shown.images, [id]);
  assert.match(second.images?.get(id) ?? '', /^data:image\/png;base64,iVBOR/);
  assert.ok(nth(second.messages, -2).role === 'tool');

  // Saved: the attachment list on the user's message, an empty display, the image message internal.
  const rows = agent.conversation.rows();
  const userRow = nth(rows, 0);
  assert.equal(userRow.display, '');
  assert.deepEqual(userRow.attachments, attachments);
  const restored = Conversation.fromRows(rows);
  assert.deepEqual(restored.attachmentsOf(0), attachments);
  assert.deepEqual(restored.visible().length, rows.filter((r) => !r.internal).length);
});

test('view_image refuses files that are not images', async () => {
  const { store, attachments } = attachmentStore([{ name: 'a.txt', bytes: Buffer.from('hi') }]);
  const shown: string[] = [];
  const ctx = toolContext({ attachments: store, showImage: (id) => shown.push(id) });
  await assert.rejects(
    viewImage.run({ attachment_id: nth(attachments, 0).id }, ctx),
    /not an image/,
  );
  assert.deepEqual(shown, []);
});

test('a new plan keeps the earlier one instead of replacing it', () => {
  const planner = new Planner();
  planner.create('First goal', ['a', 'b']);
  planner.update(1, 'done');
  const first = planner.plan;
  planner.create('Second goal', ['c']);

  assert.equal(planner.plan?.goal, 'Second goal');
  assert.deepEqual(planner.earlier, [first], 'the first plan moves to earlier, as it was');
  assert.equal(nth(planner.earlier, 0).steps[0]?.status, 'done');
  assert.ok(planner.plan?.createdAt, 'each plan records when it was made');

  planner.reset();
  assert.deepEqual(planner.earlier, []);
});

test('chat titles come from the model, cleaned up', async () => {
  assert.equal(cleanTitle('Title: "Booking QFX movie tickets."'), 'Booking QFX movie tickets');
  assert.equal(
    cleanTitle('\n  **Flights from Kathmandu to Dubai**\nmore'),
    'Flights from Kathmandu to Dubai',
  );
  assert.equal(cleanTitle('   '), null);
  assert.ok((cleanTitle('word '.repeat(40)) ?? '').length <= 61, 'long titles are cut at a word');

  const { callModel, requests } = scriptedModel([answer('Cheapest KTM to Dubai flights')]);
  const title = await suggestChatTitle(callModel, ['hello', 'cheapest flight from KTM to Dubai?']);
  assert.equal(title, 'Cheapest KTM to Dubai flights');
  const sent = nth(nth(requests, 0).messages, 0);
  assert.ok(sent.role === 'user');
  assert.match(sent.content, /1\. hello\n2\. cheapest flight/);
  assert.equal(nth(requests, 0).tools, undefined, 'a title call offers no tools');
  assert.equal(await suggestChatTitle(callModel, ['  ']), null, 'nothing to name: no call');
});

test('tools that ask first take a reason for the user, which the tool never sees', async () => {
  const props = (tool: { definition: { function: { parameters: unknown } } }) =>
    Object.keys((tool.definition.function.parameters as { properties: object }).properties);
  assert.ok(props(writeFile).includes('reason'), 'write_file asks for a reason');
  assert.ok(props(runCommand).includes('reason'), 'run_command asks for a reason');
  assert.ok(!props(readFile).includes('reason'), 'read_file needs no approval, so no reason');
  const required = (writeFile.definition.function.parameters as { required: string[] }).required;
  assert.ok(!required.includes('reason'), 'optional: a missing reason never blocks a change');

  const setup = await tempSetup();
  const ctx = toolContext({ workspace: setup.filesDir });
  const input = { path: 'a.txt', content: 'hi', reason: 'Save the greeting' };
  assert.equal(writeFile.validate(input), null);
  await writeFile.runValidated(input, ctx);
  assert.equal(await fs.readFile(path.join(setup.filesDir, 'a.txt'), 'utf8'), 'hi');
});

test('improve prompt rewrites the draft with one tool-free call and strips wrappers', async () => {
  assert.equal(
    cleanImprovedPrompt('Improved prompt:\nFix the bug in @src.'),
    'Fix the bug in @src.',
  );
  assert.equal(cleanImprovedPrompt('```\nRun the tests.\n```'), 'Run the tests.');
  assert.equal(cleanImprovedPrompt('"Run the tests."'), 'Run the tests.');

  const { callModel, requests } = scriptedModel([answer('Fix the failing login test in @src.')]);
  const text = await improvePrompt(callModel, 'fix login test @src', { workspace: 'My app' });
  assert.equal(text, 'Fix the failing login test in @src.');
  const sent = nth(nth(requests, 0).messages, 0);
  assert.ok(sent.role === 'user');
  assert.match(sent.content, /Workspace: My app[\s\S]*<draft>\nfix login test @src\n<\/draft>/);
  assert.equal(nth(requests, 0).tools, undefined);
});

test('the instructions assistant sends the workspace, project and current text in one call', async () => {
  const { callModel, requests } = scriptedModel([
    answer('Instructions:\nYou review this Node API.\n\n- Run `npm test` before you finish.'),
  ]);
  const text = await writeInstructions(callModel, {
    request: 'code reviewer, short answers',
    current: 'Be brief.',
    workspace: 'Beacon',
    folder: '/work/beacon',
    project: 'Top level: package.json, src/',
  });
  assert.equal(text, 'You review this Node API.\n\n- Run `npm test` before you finish.');
  const sent = nth(nth(requests, 0).messages, 0);
  assert.ok(sent.role === 'user');
  assert.match(
    sent.content,
    /Workspace name: Beacon[\s\S]*Folder: \/work\/beacon[\s\S]*<project>[\s\S]*<current>\nBe brief\.\n<\/current>[\s\S]*<request>\ncode reviewer, short answers\n<\/request>/,
  );
  assert.equal(nth(requests, 0).tools, undefined);

  const empty = scriptedModel([answer('  ')]);
  assert.equal(await writeInstructions(empty.callModel, { request: '', current: 'x' }), null);
});

test('the Files panel search finds names and lines, skipping generated and app folders', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-search-'));
  await fs.mkdir(path.join(dir, 'src'));
  await fs.mkdir(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  await fs.mkdir(path.join(dir, '.nimbrio-ai'));
  await fs.writeFile(
    path.join(dir, 'src', 'Greeting.ts'),
    'export const hello = 1;\nconst x = HELLO;\n',
  );
  await fs.writeFile(path.join(dir, 'greeting-notes.md'), 'nothing here\n');
  await fs.writeFile(path.join(dir, 'node_modules', 'dep', 'greeting.js'), 'hello');
  await fs.writeFile(path.join(dir, '.nimbrio-ai', 'greeting.json'), '"hello"');
  await fs.writeFile(path.join(dir, 'image.bin'), Buffer.from([0, 1, 2, 104, 101, 108, 108, 111]));

  const names = await findFilesByName(dir, 'GREET', 10);
  assert.deepEqual(names, { paths: ['src/Greeting.ts', 'greeting-notes.md'], isTruncated: false });

  await fs.mkdir(path.join(dir, 'docs', 'empty'), { recursive: true });
  assert.deepEqual(await listWorkspaceFiles(dir, 100), {
    files: ['greeting-notes.md', 'image.bin', 'src/Greeting.ts'],
    emptyFolders: ['docs/empty'],
    isTruncated: false,
  });

  // Past the limit, the deepest files are left out, never the top of the tree.
  await fs.mkdir(path.join(dir, 'a', 'deep'), { recursive: true });
  await fs.writeFile(path.join(dir, 'a', 'deep', 'one.ts'), '');
  await fs.writeFile(path.join(dir, 'a', 'deep', 'two.ts'), '');
  await fs.writeFile(path.join(dir, 'z-last.md'), '');
  assert.deepEqual(await listWorkspaceFiles(dir, 4), {
    files: ['greeting-notes.md', 'image.bin', 'z-last.md', 'src/Greeting.ts'],
    // Cut off before docs/empty was read: not known to be empty, so left out.
    emptyFolders: [],
    isTruncated: true,
  });

  const contents = await searchFileContents(dir, 'hello', 100);
  assert.deepEqual(contents.files, [
    {
      path: 'src/Greeting.ts',
      lines: [
        { line: 1, text: 'export const hello = 1;' },
        { line: 2, text: 'const x = HELLO;' },
      ],
      moreLines: 0,
    },
  ]);
  assert.equal(contents.isTruncated, false);
});

test('stopping a run halts it cleanly and keeps the chat consistent', async () => {
  // Stopped after the first of two tool calls: the second gets a result but doesn't run.
  const setup = await tempSetup();
  const stop = new AbortController();
  const { callModel, requests } = scriptedModel([
    callTools(
      toolCall('t1', 'calculator', { expression: '1 + 1' }),
      toolCall('t2', 'calculator', { expression: '2 + 2' }),
    ),
    answer('never reached'),
  ]);
  const ran: string[] = [];
  const agent = createAgent({
    ...setup,
    callModel,
    signal: stop.signal,
    logger: silentLogger,
    config: { planning: 'off' },
    onEvent: (event) => {
      if (event.type === 'tool_call') ran.push(event.id);
      if (event.type === 'tool_result' && event.id === 't1') stop.abort();
    },
  });
  const result = await agent.run('add things');
  assert.equal(result.status, 'stopped');
  assert.deepEqual(ran, ['t1'], 'the second call never started');
  assert.equal(requests.length, 1, 'no model call after the stop');
  const results = agent.conversation.messages.filter(isToolMessage);
  assert.deepEqual(
    results.map((m) => m.tool_call_id),
    ['t1', 't2'],
    'every tool call still has its result',
  );
  assert.match(nth(results, 1).content, /Stopped by the user/);

  // Stopped before the model answered: nothing half-written is kept.
  const early = new AbortController();
  const { callModel: second } = scriptedModel([answer('never shown')]);
  const agent2 = createAgent({
    ...(await tempSetup()),
    callModel: second,
    signal: early.signal,
    logger: silentLogger,
    config: { planning: 'off' },
    onEvent: (event) => {
      if (event.type === 'model_call') early.abort();
    },
  });
  assert.equal((await agent2.run('hi')).status, 'stopped');
  assert.deepEqual(
    agent2.conversation.messages.map((m) => m.role),
    ['user'],
  );
});

/** A SkillStore over a fixed list. */
function skillStore(skills: Skill[]): SkillStore {
  return {
    list: async () => skills,
    get: async (name) => skills.find((skill) => skill.name === name) ?? null,
  };
}

const TICKET_SKILL: Skill = {
  name: 'jira-ticket-fix',
  description: 'When the user gives a Jira ticket to check or fix.',
  body: 'Phase 1: verify the claim against the code.\nPhase 2: propose the smallest fix, then stop.',
  updatedAt: null,
};

test('skills are listed in the system prompt and use_skill loads one', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'use_skill', { name: 'jira-ticket-fix' })),
    answer('Verified.'),
  ]);
  const agent = createAgent({
    ...setup,
    skills: skillStore([TICKET_SKILL]),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const result = await agent.run('Check MW-4929');
  assert.equal(result.status, 'done');
  assert.deepEqual(result.toolsUsed, ['use_skill']);

  const system = nth(requests, 0).system ?? '';
  assert.match(
    system,
    /Skills in this workspace[^\n]*\n- jira-ticket-fix: When the user gives a Jira ticket/,
  );
  const loaded = nth(toolMessages(nth(requests, 1)), 0).content;
  assert.match(loaded, /\[Skill "jira-ticket-fix", written by the user/);
  assert.match(loaded, /Phase 2: propose the smallest fix/);
});

test('use_skill names the skills there are when asked for a missing one', async () => {
  const ctx = toolContext({ skills: skillStore([TICKET_SKILL]) });
  await assert.rejects(useSkill.run({ name: 'deploy' }, ctx), /The skills are: jira-ticket-fix/);
  await assert.rejects(useSkill.run({ name: 'x' }, toolContext({})), /no skills/);
});

test('skills the user picked come with the message in full and are saved on it', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([answer('On it.')]);
  const agent = createAgent({
    ...setup,
    skills: skillStore([TICKET_SKILL]),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('Check MW-4929', { skills: [TICKET_SKILL] });

  const sent = nth(nth(requests, 0).messages, -1);
  assert.ok(sent.role === 'user');
  assert.match(sent.content, /^Check MW-4929\n\n\[Skills the user picked for this message/);
  assert.match(sent.content, /<skill name="jira-ticket-fix">\nPhase 1: verify/);

  const rows = agent.conversation.rows();
  assert.equal(nth(rows, 0).display, 'Check MW-4929', 'the chat shows only what the user typed');
  assert.deepEqual(nth(rows, 0).skills, ['jira-ticket-fix']);
  assert.deepEqual(nth(Conversation.fromRows(rows).rows(), 0).skills, ['jira-ticket-fix']);
});

test('improveSkill sends the draft and reads the rewrite and description back', async () => {
  const { callModel, requests } = scriptedModel([
    answer(
      '```json\n{"description": "When the user gives a  Jira\\nticket.", "body": "1. Fetch the ticket.\\n2. Stop for approval."}\n```',
    ),
  ]);
  const improved = await improveSkill(callModel, {
    name: 'jira-ticket-fix',
    description: '',
    body: 'fetch ticket then stop',
  });
  assert.deepEqual(improved, {
    description: 'When the user gives a Jira ticket.',
    body: '1. Fetch the ticket.\n2. Stop for approval.',
  });
  const sent = nth(nth(requests, 0).messages, 0);
  assert.ok(sent.role === 'user');
  assert.match(sent.content, /Skill name: jira-ticket-fix/);
  assert.match(sent.content, /<instructions>\nfetch ticket then stop\n<\/instructions>/);
  assert.match(sent.content, /No request: tidy the current instructions\./);
});

test('improveSkill writes from a request when there are no instructions, and passes changes asked for', async () => {
  const { callModel, requests } = scriptedModel([
    answer('{"description": "When the user asks for a release.", "body": "1. Build.\\n2. Test."}'),
    answer('{"description": "", "body": "1. Build.\\n2. Test.\\n3. Stop for approval."}'),
  ]);
  const written = await improveSkill(callModel, { request: 'release checklist', body: '' });
  assert.deepEqual(written, {
    description: 'When the user asks for a release.',
    body: '1. Build.\n2. Test.',
  });
  const first = nth(nth(requests, 0).messages, 0);
  assert.ok(first.role === 'user');
  assert.match(first.content, /No instructions yet: write them\./);
  assert.match(first.content, /<request>\nrelease checklist\n<\/request>/);
  assert.doesNotMatch(first.content, /<instructions>/);

  await improveSkill(callModel, { request: 'add an approval stop', body: '1. Build.\n2. Test.' });
  const second = nth(nth(requests, 1).messages, 0);
  assert.ok(second.role === 'user');
  assert.match(second.content, /<instructions>\n1\. Build\.\n2\. Test\.\n<\/instructions>/);
  assert.match(second.content, /<request>\nadd an approval stop\n<\/request>/);
});

test('parseImprovedSkill takes a plain-text reply as the instructions, and nothing as null', () => {
  assert.deepEqual(parseImprovedSkill('1. Do this.\n2. Then that.'), {
    body: '1. Do this.\n2. Then that.',
    description: '',
  });
  assert.equal(parseImprovedSkill('  '), null);
  assert.equal(parseImprovedSkill('{"body": "", "description": "x"}'), null);
});

/** Two fake MCP tools, as toAgentTools would name them. */
function fakeMcpTools(calls: string[]) {
  const tool = (name: string, description: string) =>
    defineTool<{ key: string }>({
      name,
      description,
      properties: { key: { type: 'string', description: 'The issue key.' } },
      async run({ key }) {
        calls.push(`${name} ${key}`);
        return `${key}: Login times out`;
      },
    });
  return [
    tool('mcp__jira__getIssue', 'Get one Jira issue by key. Returns its fields.'),
    tool('mcp__jira__searchIssues', 'Search Jira issues with JQL.'),
  ];
}

const toolNames = (req: { tools?: { function: { name: string } }[] }) =>
  (req.tools ?? []).map((t) => t.function.name);

test('MCP tools are listed by name and sent only after load_mcp_tools', async () => {
  const setup = await tempSetup();
  const calls: string[] = [];
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'load_mcp_tools', { names: ['mcp__jira__getIssue'] })),
    callTools(toolCall('t2', 'mcp__jira__getIssue', { key: 'MW-1' })),
    answer('MW-1 is about a login timeout.'),
  ]);
  const agent = createAgent({
    ...setup,
    extraTools: fakeMcpTools(calls),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const result = await agent.run('What is MW-1 about?');
  assert.equal(result.status, 'done');
  assert.deepEqual(calls, ['mcp__jira__getIssue MW-1']);

  const first = nth(requests, 0);
  assert.ok(toolNames(first).includes('load_mcp_tools'));
  assert.ok(!toolNames(first).some((name) => name.startsWith('mcp__')), 'no MCP definitions yet');
  assert.match(
    first.system ?? '',
    /MCP tools you can load[^\n]*\n[\s\S]*- mcp__jira__getIssue: Get one Jira issue by key\.\n- mcp__jira__searchIssues: Search Jira issues with JQL\./,
  );
  assert.match(nth(toolMessages(nth(requests, 1)), 0).content, /Loaded: mcp__jira__getIssue/);
  assert.deepEqual(
    toolNames(nth(requests, 1)).filter((name) => name.startsWith('mcp__')),
    ['mcp__jira__getIssue'],
    'only the loaded one is sent',
  );
});

test('load_mcp_tools takes a prefix, reports unknown names, and earlier calls stay loaded', async () => {
  const setup = await tempSetup();
  const calls: string[] = [];
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'load_mcp_tools', { names: ['mcp__jira__*', 'mcp__github__x'] })),
    answer('Loaded.'),
    answer('Again.'),
  ]);
  const agent = createAgent({
    ...setup,
    extraTools: fakeMcpTools(calls),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('Load the Jira tools.');
  const loaded = nth(toolMessages(nth(requests, 1)), 0).content;
  assert.match(loaded, /Loaded: mcp__jira__getIssue, mcp__jira__searchIssues/);
  assert.match(loaded, /Not found: mcp__github__x/);

  // The next request in the same chat: a new agent, as the app makes one per request.
  const next = createAgent({
    ...setup,
    conversation: Conversation.fromRows(agent.conversation.rows()),
    extraTools: fakeMcpTools(calls),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await next.run('Thanks');
  // load_mcp_tools itself was called earlier, but only MCP tools that were called come back.
  assert.deepEqual(
    toolNames(nth(requests, 2)).filter((name) => name.startsWith('mcp__')),
    [],
  );
});

test('a chat that called an MCP tool sends its definition again from the start', async () => {
  const setup = await tempSetup();
  const calls: string[] = [];
  const conversation = new Conversation();
  conversation.addUser('What is MW-1 about?');
  conversation.addAssistant({
    content: null,
    tool_calls: [toolCall('t1', 'mcp__jira__getIssue', { key: 'MW-1' })],
  });
  conversation.addToolResult('t1', 'MW-1: Login times out');
  conversation.addAssistant({ content: 'A login timeout.' });
  const { callModel, requests } = scriptedModel([answer('Still a login timeout.')]);
  const agent = createAgent({
    ...setup,
    conversation,
    extraTools: fakeMcpTools(calls),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('And again?');
  assert.deepEqual(
    toolNames(nth(requests, 0)).filter((name) => name.startsWith('mcp__')),
    ['mcp__jira__getIssue'],
  );
});

test('without MCP tools there is no load_mcp_tools and no MCP list', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([answer('Hi!')]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('hello');
  assert.ok(!toolNames(nth(requests, 0)).includes('load_mcp_tools'));
  assert.doesNotMatch(nth(requests, 0).system ?? '', /MCP tools you can load/);
});

test('a workspace that turns tool groups off sends neither their tools nor their guidance', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'read_file', { path: 'notes.txt' })),
    answer('I can only chat here.'),
  ]);
  const agent = createAgent({
    ...setup,
    disabledTools: ['files', 'commands', 'web', 'plans'],
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('Read notes.txt');
  const first = nth(requests, 0);
  const names = toolNames(first);
  for (const off of ['read_file', 'write_file', 'run_command', 'web_search', 'create_plan']) {
    assert.ok(!names.includes(off), `${off} is not sent`);
  }
  for (const on of ['remember', 'recall', 'get_current_time', 'calculator']) {
    assert.ok(names.includes(on), `${on} is sent`);
  }
  const system = first.system ?? '';
  assert.doesNotMatch(system, /\nFiles:\n|\nCommands:\n|\nResearch:\n|Working through a plan/);
  assert.match(system, /\nMemory:\n/);
  assert.match(system, /Tools that ask first take a `reason`/, 'approval guidance stays');
  assert.match(nth(toolMessages(nth(requests, 1)), 0).content, /turned off the tools read_file/);
});

test('voice mode asks for short spoken replies, before the workspace instructions', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([answer('Sure.'), answer('Sure.')]);
  const options = {
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' as const },
  };
  await createAgent({ ...options, instructions: 'Reply in Nepali.' }).run('hello');
  assert.doesNotMatch(nth(requests, 0).system ?? '', /Voice conversation:/);

  await createAgent({ ...options, instructions: 'Reply in Nepali.', voiceReplies: true }).run('hi');
  const system = nth(requests, 1).system ?? '';
  assert.match(system, /Voice conversation:[\s\S]*read aloud/);
  assert.ok(
    system.indexOf('Voice conversation:') < system.indexOf('Reply in Nepali.'),
    "the user's own instructions come after, so they win",
  );
});

test('attachment and skill tools are sent only when the chat has files or skills', async () => {
  const setup = await tempSetup();
  const { callModel, requests } = scriptedModel([answer('Hi!'), answer('A pixel.')]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('hello');
  const plain = toolNames(nth(requests, 0));
  assert.ok(!plain.includes('read_attachment') && !plain.includes('use_skill'));
  assert.doesNotMatch(nth(requests, 0).system ?? '', /\nSkills:\n/);

  const { store, attachments } = attachmentStore([{ name: 'a.png', bytes: PNG }]);
  const withFiles = createAgent({
    ...setup,
    attachments: store,
    skills: skillStore([TICKET_SKILL]),
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await withFiles.run('What is this?', { attachments });
  const names = toolNames(nth(requests, 1));
  assert.ok(names.includes('read_attachment') && names.includes('view_image'));
  assert.ok(names.includes('use_skill'));
  assert.match(nth(requests, 1).system ?? '', /\nSkills:\n/);
});

test('a tool the chat called before stays sent after its group is turned off, but refuses', async () => {
  const setup = await tempSetup();
  const conversation = new Conversation();
  conversation.addUser('Search for X');
  conversation.addAssistant({
    content: null,
    tool_calls: [toolCall('t1', 'web_search', { query: 'X' })],
  });
  conversation.addToolResult('t1', 'results');
  conversation.addAssistant({ content: 'Found it.' });
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t2', 'web_search', { query: 'Y' })),
    answer('Web is off here.'),
  ]);
  const agent = createAgent({
    ...setup,
    conversation,
    disabledTools: ['web'],
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  await agent.run('Search for Y');
  const names = toolNames(nth(requests, 0));
  assert.ok(names.includes('web_search'), 'sent: the history refers to it');
  assert.ok(!names.includes('fetch_page'));
  assert.match(nth(toolMessages(nth(requests, 1)), -1).content, /turned off/);
});

test('readUsage counts cache writes and reads, whatever fields the server uses', () => {
  // The three shapes the app's model server (an OpenAI-compatible proxy to Claude) returned.
  assert.deepEqual(
    readUsage({ prompt_tokens: 13, completion_tokens: 3, cache_creation_input_tokens: 5866 }),
    { inputTokens: 5879, outputTokens: 3, cacheWriteTokens: 5866 },
    'a write left out of prompt_tokens is added back',
  );
  assert.deepEqual(
    readUsage({
      prompt_tokens: 5879,
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: 5866 },
      cache_read_input_tokens: 5866,
    }),
    { inputTokens: 5879, outputTokens: 3, cachedInputTokens: 5866 },
  );
  assert.deepEqual(
    readUsage({
      prompt_tokens: 5879,
      completion_tokens: 3,
      cache_read_input_tokens: 5866,
      cache_creation_input_tokens: 12,
    }),
    { inputTokens: 5879, outputTokens: 3, cachedInputTokens: 5866, cacheWriteTokens: 12 },
    'a follow-up: read and a small write, both inside prompt_tokens',
  );
  // OpenAI's own shape, and nothing usable.
  assert.deepEqual(
    readUsage({
      prompt_tokens: 2000,
      completion_tokens: 50,
      prompt_tokens_details: { cached_tokens: 1536 },
    }),
    { inputTokens: 2000, outputTokens: 50, cachedInputTokens: 1536 },
  );
  assert.deepEqual(readUsage(null), { inputTokens: 0, outputTokens: 0 });
});

test('a request adds up its calls, cache included', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([answer('Hi!')]);
  const cachingModel: CallModel = async (req) => ({
    ...(await callModel(req)),
    usage: { inputTokens: 4000, outputTokens: 20, cachedInputTokens: 3800, cacheWriteTokens: 150 },
  });
  const agent = createAgent({
    ...setup,
    callModel: cachingModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const result = await agent.run('hello');
  assert.deepEqual(result.usage, {
    inputTokens: 4000,
    outputTokens: 20,
    cachedInputTokens: 3800,
    cacheWriteTokens: 150,
  });
});

test('a request records each model call: what it was for, the model, its tools and tokens', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([
    callTools(
      toolCall('t1', 'list_files', {}),
      toolCall('t2', 'calculator', { expression: '1+1' }),
    ),
    answer('Done.'),
  ]);
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const result = await agent.run('look around');
  assert.deepEqual(
    result.calls.map(({ kind, model, toolCalls, inputTokens, outputTokens }) => ({
      kind,
      model,
      toolCalls,
      inputTokens,
      outputTokens,
    })),
    [
      {
        kind: 'step',
        model: 'fake',
        toolCalls: ['list_files', 'calculator'],
        inputTokens: 10,
        outputTokens: 5,
      },
      { kind: 'step', model: 'fake', toolCalls: [], inputTokens: 10, outputTokens: 5 },
    ],
  );
  assert.ok(result.calls.every((call) => call.durationMs >= 0));
  assert.equal(result.calls.length, result.steps, 'every call counted as a step is listed');
});

test('each call says what its tokens went to, adding up to what the server reported', async () => {
  const setup = await tempSetup();
  const { callModel } = scriptedModel([
    callTools(toolCall('t1', 'calculator', { expression: '1+1' })),
    answer('It is 2.'),
  ]);
  const reporting: CallModel = async (req) => ({
    ...(await callModel(req)),
    usage: { inputTokens: 20_000, outputTokens: 400 },
  });
  const agent = createAgent({
    ...setup,
    callModel: reporting,
    logger: silentLogger,
    config: { planning: 'off' },
  });
  const { calls } = await agent.run('what is 1+1');
  const second = nth(calls, 1);
  const sum = (groups: { tokens: number }[]) => groups.reduce((n, g) => n + g.tokens, 0);
  assert.ok(Math.abs(sum(second.input) - 20_000) <= second.input.length * 8, 'parts add up');
  const group = (id: string) => second.input.find((g) => g.id === id);
  assert.ok(group('system')?.items.some((item) => item.label === 'Agent instructions'));
  const tools = group('tools');
  assert.ok(tools && tools.items.length <= 8, 'tool definitions, the largest listed');
  assert.deepEqual(
    group('user')?.items.map((item) => item.label),
    ['what is 1+1'],
  );
  assert.deepEqual(
    group('results')?.items.map((item) => item.label),
    ['calculator: 1+1'],
  );
  assert.ok(group('history'), 'the earlier tool call is counted');
  assert.deepEqual(
    nth(calls, 0)
      .output.map((g) => g.id)
      .sort(),
    ['reasoning', 'tool_calls'],
    'beyond the tool call, the output is reasoning and formatting',
  );
});

test('a step tells the user’s words from added context, notes and the summary', () => {
  const groups = inputBreakdown(
    {
      system: 'ab',
      messages: [
        { role: 'user', content: 'Summary of the chat so far' },
        { role: 'user', content: 'Memories: likes tea\n\nhi there' },
        { role: 'user', content: 'Check your plan' },
      ],
    },
    0,
    {
      sections: [{ label: 'Agent instructions', text: 'ab' }],
      infos: [
        { isSummary: true, isInternal: true, display: undefined },
        { isSummary: false, isInternal: false, display: 'hi there' },
        { isSummary: false, isInternal: true, display: undefined },
      ],
    },
  );
  const labels = (id: string) => groups.find((g) => g.id === id)?.items.map((i) => i.label);
  assert.deepEqual(labels('summary'), ['Summary of earlier messages']);
  assert.deepEqual(labels('user'), ['hi there']);
  assert.deepEqual(labels('context')?.sort(), [
    'Added to “hi there”',
    'Agent note: Check your plan',
  ]);
  // Another call's prompt is one part, and many items fold into "Others".
  const many = inputBreakdown(
    { system: 's', messages: [{ role: 'user', content: 'x'.repeat(40) }] },
    0,
  );
  assert.deepEqual(many.map((g) => g.id).sort(), ['prompt', 'system']);
  const reply = outputBreakdown(
    {
      role: 'assistant',
      content: null,
      tool_calls: Array.from({ length: 10 }, (_, i) =>
        toolCall(`t${i}`, 'read_file', { path: `f${i}.ts` }),
      ),
    },
    0,
  );
  const calls = reply.find((g) => g.id === 'tool_calls');
  assert.equal(calls?.items.length, 8);
  assert.equal(calls?.items.at(-1)?.label, 'Others');
  assert.equal(calls?.items.at(-1)?.count, 3);
});

// ---------- Context window: management and compaction ----------

test('a summary stands in for the messages it covers, and survives saving', () => {
  const conversation = new Conversation();
  conversation.addUser('first question');
  conversation.addAssistant({ content: 'first answer' });
  conversation.addUser('second question');
  conversation.addAssistant({ content: 'second answer' });
  conversation.addSummary('SUMMARY of the first exchange', 2);
  conversation.addUser('third question');

  const view = conversation.forModel();
  assert.deepEqual(
    view.messages.map((m) => m.content),
    ['SUMMARY of the first exchange', 'second question', 'second answer', 'third question'],
  );
  assert.deepEqual(view.indexes, [4, 2, 3, 5]);
  assert.equal(conversation.messages.length, 6, 'nothing is deleted');
  assert.ok(conversation.isInternal(4), 'the summary is hidden from the chat');

  const saved = conversation.rows();
  assert.equal(saved[4]?.summaryOf, 2);
  const restored = Conversation.fromRows(saved);
  assert.deepEqual(restored.forModel().indexes, [4, 2, 3, 5]);

  // A newer summary replaces the older one entirely.
  restored.addSummary('SUMMARY of everything', 6);
  restored.addUser('fourth question');
  assert.deepEqual(
    restored.forModel().messages.map((m) => m.content),
    ['SUMMARY of everything', 'fourth question'],
  );
});

test('the cut keeps recent messages and never starts on a tool result', () => {
  const big = 'x'.repeat(4_000); // 1,000 tokens
  const messages: ModelMessage[] = [
    { role: 'user', content: big },
    { role: 'assistant', content: big },
    { role: 'user', content: 'go' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [toolCall('t1', 'read_file', { path: 'a' })],
    },
    { role: 'tool', tool_call_id: 't1', content: 'small result' },
  ];
  const cut = compactionCut(messages, 200);
  assert.equal(cut, 2, 'keeps from the user message on, with the call and its result together');
  assert.equal(compactionCut(messages.slice(0, 1), 200), null, 'one message: nothing to gain');
  // The latest tool results are never shortened; older ones are.
  const withOld: ModelMessage[] = [
    { role: 'assistant', content: '', tool_calls: [toolCall('t0', 'read_file', { path: 'b' })] },
    { role: 'tool', tool_call_id: 't0', content: big },
    ...messages.slice(2),
  ];
  const shrunk = shrinkToolResults(withOld, 500);
  assert.match(shrunk[1]?.content ?? '', /left out to fit the model's context window/);
  assert.equal(shrunk.at(-1)?.content, 'small result');
});

test('limits scale with the window, and long transcripts are summarized in parts', () => {
  const small = contextBudget(8_000, null);
  assert.equal(small.reserve, 800);
  assert.equal(contextBudget(200_000, 300_000).reserve, 100_000, 'the reply gets at most half');
  assert.ok(contextLimits(small).toolOutputChars < 20_000);
  assert.equal(contextLimits(contextBudget(1_000_000, null)).toolOutputChars, 20_000);
  const long: ModelMessage[] = Array.from({ length: 20 }, (_, i) => ({
    role: 'user',
    content: `${i} ${'y'.repeat(3_000)}`,
  }));
  const chunks = transcriptChunks(long, small);
  assert.ok(chunks.length > 1, 'too long for one call');
  for (const chunk of chunks) assert.ok(textTokens(chunk) <= small.usable * 0.5 + 10);
});

test('near the context window, older messages are summarized and the chat goes on', async () => {
  const setup = await tempSetup();
  const requests: Omit<ModelRequest, 'onText'>[] = [];
  const callModel: CallModel = async ({ onText: _onText, ...req }) => {
    requests.push(structuredClone(req));
    const isSummary = req.system === COMPACTION_PROMPT;
    return {
      model: 'fake',
      usage: { inputTokens: 10, outputTokens: 5 },
      finishReason: 'stop',
      message: {
        role: 'assistant',
        content: isSummary ? 'The user is planning a trip to Kyoto in May.' : 'Here you go.',
      },
    };
  };
  const options = {
    ...setup,
    callModel,
    logger: silentLogger,
    disabledTools: ['files', 'commands', 'web', 'plans'] as const,
    config: { planning: 'off' as const },
  };
  // How big the system prompt and tools are on their own, to pick a window that fits them.
  await createAgent({ ...options, disabledTools: [...options.disabledTools] }).run('hi');
  const first = nth(requests, 0);
  const base = textTokens(first.system) + textTokens(JSON.stringify(first.tools ?? []));
  requests.length = 0;

  // An earlier chat of about 10,000 tokens, and a window it nearly fills.
  const conversation = new Conversation();
  for (let i = 0; i < 5; i += 1) {
    conversation.addUser(`question ${i} ${'q'.repeat(4_000)}`);
    conversation.addAssistant({ content: `answer ${i} ${'a'.repeat(4_000)}` });
  }
  const events: AgentEvent[] = [];
  const agent = createAgent({
    ...options,
    disabledTools: [...options.disabledTools],
    conversation,
    contextWindow: Math.ceil((base + 6_000) / 0.72),
    onEvent: (event) => events.push(event),
  });
  const result = await agent.run('What should I pack?');
  assert.equal(result.text, 'Here you go.');

  const compaction = events.find((event) => event.type === 'compaction');
  assert.ok(compaction && compaction.type === 'compaction', 'a compaction event');
  assert.ok(compaction.tokensAfter < compaction.tokensBefore);
  assert.ok(compaction.summarizedMessages >= 2);
  assert.ok(
    requests.some((r) => r.system === COMPACTION_PROMPT),
    'a summarizing call',
  );

  const final = nth(requests, -1);
  assert.notEqual(final.system, COMPACTION_PROMPT);
  assert.match(final.messages[0]?.content ?? '', /^\[Summary of the earlier conversation/);
  assert.match(final.messages[0]?.content ?? '', /trip to Kyoto in May/);
  assert.equal(final.messages.at(-1)?.content.endsWith('What should I pack?'), true);
  assert.ok(final.messages.length < conversation.messages.length, 'older messages not sent');

  // Saved with the chat: reloading it sends the summary again, not the old messages.
  const restored = Conversation.fromRows(conversation.rows());
  assert.ok(restored.latestSummary() !== null);
  assert.equal(restored.messages.length, conversation.messages.length, 'the chat keeps them all');
  assert.ok(
    events.some((event) => event.type === 'context'),
    'reports how full the window is',
  );
});

test('messages sent mid-run reach the model between steps and before it settles on an answer', async () => {
  const setup = await tempSetup();
  const steer = (id: string, text: string): SteeringMessage => ({
    id,
    text,
    sentAt: '2026-11-07T10:00:00.000Z',
  });
  // What the inbox holds at each take: before call 1, after the tool (before call 2), at the
  // first answer, before call 3, at the second answer.
  const takes: SteeringMessage[][] = [
    [],
    [steer('s1', 'Use 7 times 6.')],
    [steer('s2', 'Also double it.')],
  ];
  const { callModel, requests } = scriptedModel([
    callTools(toolCall('t1', 'calculator', { expression: '6 * 7' })),
    answer("It's 42."),
    answer("It's 42; doubled, 84."),
  ]);
  const events: AgentEvent[] = [];
  const agent = createAgent({
    ...setup,
    callModel,
    logger: silentLogger,
    config: { planning: 'off' },
    steering: { take: () => takes.shift() ?? [] },
    onEvent: (event) => events.push(event),
  });
  const result = await agent.run('What is 6 times 7?');

  assert.equal(result.status, 'done');
  assert.equal(result.text, "It's 42; doubled, 84.");
  assert.equal(requests.length, 3, 'the second message reopened the finished answer');
  // After the tool's result, never between a tool call and its result.
  const second = nth(requests, 1).messages;
  assert.equal(nth(second, -2).role, 'tool');
  assert.ok(nth(second, -1).role === 'user');
  assert.match(nth(second, -1).content, /while you were working[\s\S]*Use 7 times 6\./);
  // After the answer it had given.
  const third = nth(requests, 2).messages;
  assert.equal(nth(third, -2).content, "It's 42.");
  assert.match(nth(third, -1).content, /Also double it\./);
  assert.deepEqual(
    events.filter((event) => event.type === 'steer').map((event) => event.id),
    ['s1', 's2'],
  );

  // Saved as the user's own messages (what they typed, and when), not as new requests.
  const steered = agent.conversation.rows().filter((row) => row.steeredAt !== undefined);
  assert.deepEqual(
    steered.map((row) => [row.display, row.internal, row.steeredAt]),
    [
      ['Use 7 times 6.', false, '2026-11-07T10:00:00.000Z'],
      ['Also double it.', false, '2026-11-07T10:00:00.000Z'],
    ],
  );
  const reloaded = Conversation.fromRows(agent.conversation.rows());
  assert.deepEqual(reloaded.rows(), agent.conversation.rows());
});
