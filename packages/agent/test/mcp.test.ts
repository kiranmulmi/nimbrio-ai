// Offline tests for MCP servers: a real stdio server (test/fixtures/echo-mcp-server.mjs)
// and a fake model. Run with: npm run test -w @app/agent
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServerConfig } from '@app/shared';
import { createAgent } from '../src/agent.js';
import type { CallModel, ModelReply } from '../src/llm.js';
import type { AgentLogger } from '../src/logger.js';
import { McpHub } from '../src/mcp/hub.js';
import { agentToolName, formatResult } from '../src/mcp/tools.js';
import { LongTermMemory } from '../src/memory/long-term.js';
import type { ModelMessage } from '../src/memory/short-term.js';
import { Planner } from '../src/planner.js';
import type { AnyTool, ToolContext } from '../src/tools/define.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/echo-mcp-server.mjs', import.meta.url));

const silentLogger: AgentLogger = { file: null, event() {}, step() {}, warn() {}, error() {} };

const echoServer = (extra: Partial<McpServerConfig> = {}): McpServerConfig => ({
  command: process.execPath,
  args: [FIXTURE],
  ...extra,
});

async function tempFolder(): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mcp-test-')));
}

function toolNamed(tools: readonly AnyTool[], name: string): AnyTool {
  const tool = tools.find((t) => t.name === name);
  assert.ok(tool, `no tool named ${name}`);
  return tool;
}

const unusedContext = (): ToolContext => ({
  planner: new Planner(),
  longTermMemory: new LongTermMemory(path.join(os.tmpdir(), 'agent-mcp-unused-memory.json')),
  workspace: os.tmpdir(),
  searxngUrl: 'http://127.0.0.1:1',
  attachments: null,
  skills: null,
  loadTools: null,
  tasks: null,
  showImage: () => {},
});

test('a stdio MCP server starts in the workspace and its tools work as agent tools', async () => {
  const folder = await tempFolder();
  const hub = new McpHub();
  const previousKey = process.env.AGENT_API_KEY;
  process.env.AGENT_API_KEY = 'app-secret';
  try {
    const { tools, reports } = await hub.tools(folder, {
      echo: echoServer({ env: { EXTRA: 'configured' }, autoApprove: ['echo'] }),
    });

    assert.deepEqual(
      reports.map((r) => [r.name, r.state, r.tools.map((t) => t.name)]),
      [['echo', 'connected', ['echo', 'fail', 'whereami']]],
    );
    assert.deepEqual(
      tools.map((t) => [t.name, t.needsApproval]),
      [
        ['mcp__echo__echo', false],
        ['mcp__echo__fail', true],
        ['mcp__echo__whereami', true],
      ],
      'only tools in autoApprove skip the approval',
    );

    const echo = toolNamed(tools, 'mcp__echo__echo');
    assert.match(echo.definition.function.description, /Echo the text back\..*"echo" MCP server/);
    assert.equal(echo.validate({}), 'Missing required argument "text".');
    assert.equal(echo.validate({ text: 'hi' }), null);
    assert.equal(await echo.runValidated({ text: 'hi' }, unusedContext()), 'echo: hi');

    await assert.rejects(
      toolNamed(tools, 'mcp__echo__fail').runValidated({}, unusedContext()),
      /it broke/,
      'a result flagged isError becomes a tool error',
    );

    const where = JSON.parse(
      String(await toolNamed(tools, 'mcp__echo__whereami').runValidated({}, unusedContext())),
    ) as { cwd: string; secret: string | null; extra: string | null };
    assert.equal(where.cwd, folder, 'runs in the workspace folder');
    assert.equal(where.secret, null, "the app's own secrets aren't passed on");
    assert.equal(where.extra, 'configured', 'the configured env is');
  } finally {
    if (previousKey === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = previousKey;
    await hub.close();
  }
});

test('a server is reused, restarted when its config changes, and stopped when removed', async () => {
  const folder = await tempFolder();
  const hub = new McpHub();
  const pidOf = async (servers: Record<string, McpServerConfig>) => {
    const { tools } = await hub.tools(folder, servers);
    const out = await toolNamed(tools, 'mcp__echo__whereami').runValidated({}, unusedContext());
    return (JSON.parse(String(out)) as { pid: number }).pid;
  };
  try {
    const first = await pidOf({ echo: echoServer() });
    assert.equal(await pidOf({ echo: echoServer({ autoApprove: ['echo'] }) }), first, 'reused');
    const changed = await pidOf({ echo: echoServer({ env: { EXTRA: 'new' } }) });
    assert.notEqual(changed, first, 'a new env means a new process');

    assert.deepEqual(await hub.connect(folder, {}), []);
    assert.throws(() => process.kill(changed, 0), 'removed from the config: stopped');
  } finally {
    await hub.close();
  }
});

test('a server that fails to start is reported, not thrown', async () => {
  const hub = new McpHub({ logger: silentLogger, retryMs: 0 });
  try {
    const [report] = await hub.connect(await tempFolder(), {
      broken: { command: 'definitely-not-a-real-mcp-command' },
    });
    assert.equal(report?.state, 'error');
    assert.match(
      report?.error ?? '',
      /Couldn't find the command "definitely-not-a-real-mcp-command"/,
    );
  } finally {
    await hub.close();
  }
});

test('the agent calls an MCP tool, asking first unless it is auto-approved', async () => {
  const folder = await tempFolder();
  const hub = new McpHub();
  const reply = (message: ModelReply) => ({
    model: 'fake',
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: 'stop',
    message,
  });
  const runOnce = async (autoApprove: string[]) => {
    const { tools } = await hub.tools(folder, { echo: echoServer({ autoApprove }) });
    const seen: ModelMessage[][] = [];
    const asked: string[] = [];
    let call = 0;
    const callModel: CallModel = async ({ messages }) => {
      seen.push(structuredClone(messages));
      call += 1;
      return call === 1
        ? reply({
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 't1',
                type: 'function',
                function: { name: 'mcp__echo__echo', arguments: '{"text":"hello"}' },
              },
            ],
          })
        : reply({ role: 'assistant', content: 'Done.' });
    };
    const agent = createAgent({
      filesDir: folder,
      longTermMemory: new LongTermMemory(path.join(folder, 'memory.json')),
      extraTools: tools,
      callModel,
      logger: silentLogger,
      approve: async (name) => {
        asked.push(name);
        return false;
      },
      config: { planning: 'off' },
    });
    await agent.run('Echo hello');
    const toolResult = seen[1]?.find((m) => m.role === 'tool');
    return { asked, result: toolResult?.content ?? '' };
  };
  try {
    const denied = await runOnce([]);
    assert.deepEqual(denied.asked, ['mcp__echo__echo']);
    assert.match(denied.result, /^Error: The user did not approve/);

    const allowed = await runOnce(['echo']);
    assert.deepEqual(allowed.asked, [], 'auto-approved: not asked');
    assert.equal(allowed.result, 'echo: hello');
  } finally {
    await hub.close();
  }
});

test('MCP tool names fit the model API and results read as text', () => {
  assert.equal(agentToolName('git hub', 'create.issue'), 'mcp__git_hub__create_issue');
  const long = agentToolName('server', 'x'.repeat(80));
  assert.ok(long.length <= 64 && /^mcp__server__x+_[0-9a-f]{6}$/.test(long));

  assert.equal(
    formatResult({
      content: [
        { type: 'text', text: 'one' },
        { type: 'image', mimeType: 'image/png', data: 'AAAA' },
        { type: 'resource_link', name: 'Spec', uri: 'file:///spec.md' },
      ],
    }),
    'one\n\n[image (image/png) not shown]\n\n[Spec: file:///spec.md]',
  );
  assert.equal(formatResult({ content: [], structuredContent: { a: 1 } }), '{\n  "a": 1\n}');
  assert.equal(formatResult({ content: [] }), '(The tool returned nothing.)');
});
