// Offline tests for the files each workspace keeps in <folder>/.nimbrio-ai (no server needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ChatMessage } from '@app/agent';
import { TOOL_RESULT_PREVIEW_CHARS } from '@app/shared';
import { WorkspaceData } from '../src/workspace-data.js';
import { WorkspaceAttachments, cleanFileName } from '../src/attachments.js';
import { historyForUi } from '../src/chat-session.js';

async function tempFolder(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-data-test-'));
}

const run = {
  prompt: 'hi',
  status: 'done' as const,
  steps: 2,
  toolsUsed: ['read_file'],
  usage: { inputTokens: 100, outputTokens: 20 },
  calls: [
    {
      kind: 'step' as const,
      model: 'm',
      durationMs: 1200,
      toolCalls: ['read_file'],
      input: [
        {
          id: 'results' as const,
          tokens: 40,
          items: [{ label: 'read_file: a.ts', tokens: 40, count: 1 }],
        },
      ],
      output: [],
      inputTokens: 60,
      outputTokens: 12,
    },
    {
      kind: 'step' as const,
      model: 'm',
      durationMs: 800,
      toolCalls: [],
      input: [],
      output: [],
      inputTokens: 40,
      outputTokens: 8,
      cachedInputTokens: 30,
    },
  ],
  startedAt: new Date(),
};

test('settings, chats, messages and runs are saved under .nimbrio-ai', async () => {
  const folder = await tempFolder();
  const data = new WorkspaceData(folder);
  const defaults = {
    instructions: '',
    planning: 'default',
    disabledTools: [],
    voiceMode: false,
    hasTerminalTab: false,
    hasGitTab: false,
  };
  assert.deepEqual(await data.readSettings(), defaults, 'defaults before any write');

  await data.writeSettings({ instructions: 'Be brief.' });
  assert.deepEqual(await data.readSettings(), { ...defaults, instructions: 'Be brief.' });
  // A write changes only what it's given.
  await data.writeSettings({
    planning: 'off',
    disabledTools: ['files', 'web'],
    voiceMode: true,
    hasTerminalTab: true,
  });
  assert.deepEqual(await data.readSettings(), {
    instructions: 'Be brief.',
    planning: 'off',
    disabledTools: ['files', 'web'],
    voiceMode: true,
    hasTerminalTab: true,
    hasGitTab: false,
  });
  // Hand-edited values the app doesn't know fall back instead of breaking the workspace.
  await fs.writeFile(
    path.join(folder, '.nimbrio-ai', 'settings.json'),
    JSON.stringify({
      instructions: 'x',
      planning: 'sometimes',
      disabledTools: ['files', 'teleport', 'files'],
      voiceMode: 'yes',
      hasTerminalTab: 1,
      hasGitTab: 'on',
    }),
  );
  assert.deepEqual(await data.readSettings(), {
    instructions: 'x',
    planning: 'default',
    disabledTools: ['files'],
    voiceMode: false,
    hasTerminalTab: false,
    hasGitTab: false,
  });
  // An older file's single hasCodingTabs switch turns on both tabs, and isn't written back.
  await fs.writeFile(
    path.join(folder, '.nimbrio-ai', 'settings.json'),
    JSON.stringify({ instructions: 'x', hasCodingTabs: true }),
  );
  assert.deepEqual(await data.readSettings(), {
    instructions: 'x',
    planning: 'default',
    disabledTools: [],
    voiceMode: false,
    hasTerminalTab: true,
    hasGitTab: true,
  });
  await data.writeSettings({ hasGitTab: false });
  const rewritten = JSON.parse(
    await fs.readFile(path.join(folder, '.nimbrio-ai', 'settings.json'), 'utf8'),
  ) as Record<string, unknown>;
  assert.equal(rewritten.hasTerminalTab, true);
  assert.equal(rewritten.hasGitTab, false);
  assert.ok(!('hasCodingTabs' in rewritten), 'the old key is dropped on save');
  await data.writeSettings({ instructions: 'Be brief.', planning: 'default', disabledTools: [] });
  assert.equal(
    await fs.readFile(path.join(folder, '.nimbrio-ai', '.gitignore'), 'utf8'),
    "# This app's chats, memory and settings. Keep them out of git.\n*\n",
    'the folder keeps itself out of git',
  );

  const chat = await data.createChat('First');
  const messages: ChatMessage[] = [
    { role: 'user', content: 'context\n\nhi', display: 'hi' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 't1', content: 'file text' },
    { role: 'user', content: 'check your plan', internal: true },
    { role: 'assistant', content: 'Hello!' },
  ];
  const plan = {
    goal: 'Greet',
    doneWhen: '',
    steps: [{ text: 'Say hi', status: 'done' as const, note: '' }],
  };
  await data.saveRun(chat.id, { fromSeq: 0, messages, plan, memoryShown: '- fact', run });

  const loaded = await data.loadMessages(chat.id);
  assert.deepEqual(
    loaded.map((m) => [m.role, m.content, m.internal, m.display]),
    [
      ['user', 'context\n\nhi', false, 'hi'],
      ['assistant', '', false, null],
      ['tool', 'file text', false, null],
      ['user', 'check your plan', true, null],
      ['assistant', 'Hello!', false, null],
    ],
  );
  const toolCall = loaded[1];
  assert.ok(toolCall?.role === 'assistant');
  assert.equal(toolCall.tool_calls?.[0]?.function.name, 'read_file');

  const saved = await data.readChat(chat.id);
  assert.equal(saved?.plan?.goal, 'Greet');
  assert.equal(saved?.memoryShown, '- fact');
  const runs = await data.loadRuns(chat.id);
  const { finishedAt, startedAt, ...record } = runs.get(0) ?? { finishedAt: '', startedAt: '' };
  assert.ok(!Number.isNaN(Date.parse(finishedAt)), 'when the request ended is kept');
  assert.equal(startedAt, run.startedAt.toISOString(), 'when the request started is kept');
  const firstUser = historyForUi(loaded, runs)[0];
  assert.ok(firstUser?.role === 'user');
  assert.equal(firstUser.sentAt, startedAt, 'the message shows when it was sent');
  assert.deepEqual(record, {
    startSeq: 0,
    status: 'done',
    steps: 2,
    inputTokens: 100,
    outputTokens: 20,
    cachedInputTokens: 0, // this run's usage had no cache split
    cacheWriteTokens: 0,
    calls: [
      { ...run.calls[0], cachedInputTokens: 0, cacheWriteTokens: 0 },
      { ...run.calls[1], cacheWriteTokens: 0 },
    ],
  });
  const meta = historyForUi(loaded, runs).at(-1);
  assert.ok(meta?.role === 'meta');
  assert.equal(meta.calls.length, 2, 'the chat gets each call for the usage breakdown');

  // A record saved before calls were kept still loads, with none.
  const runsFile = path.join(folder, '.nimbrio-ai', 'chats', chat.id, 'runs.jsonl');
  const { calls: _calls, ...older } = JSON.parse((await fs.readFile(runsFile, 'utf8')).trim()) as {
    calls: unknown;
  };
  await fs.writeFile(runsFile, `${JSON.stringify(older)}\n`);
  assert.deepEqual((await data.loadRuns(chat.id)).get(0)?.calls, []);

  const lines = await fs.readFile(
    path.join(folder, '.nimbrio-ai', 'chats', chat.id, 'messages.jsonl'),
    'utf8',
  );
  assert.equal(lines.trimEnd().split('\n').length, 5, 'one line per message');
  assert.equal(await data.countChats(), 1);
  assert.equal(await data.lastChatActivity(), saved?.updatedAt, 'the saved run counts as activity');
});

test('last chat activity is the newest chat update, or null with no chats', async () => {
  const data = new WorkspaceData(await tempFolder());
  assert.equal(await data.lastChatActivity(), null);
  const older = await data.createChat('older');
  const newer = await data.createChat('newer');
  await data.updateChat(older.id, { updatedAt: '2020-01-01T00:00:00.000Z' });
  await data.updateChat(newer.id, { updatedAt: '2024-06-01T00:00:00.000Z' });
  assert.equal(await data.lastChatActivity(), '2024-06-01T00:00:00.000Z');
});

test('a save that would skip or repeat messages is refused', async () => {
  const data = new WorkspaceData(await tempFolder());
  const chat = await data.createChat('x');
  await data.saveRun(chat.id, {
    fromSeq: 0,
    messages: [{ role: 'user', content: 'a' }],
    plan: null,
    memoryShown: null,
  });
  await assert.rejects(
    data.saveRun(chat.id, {
      fromSeq: 0,
      messages: [{ role: 'user', content: 'b' }],
      plan: null,
      memoryShown: null,
    }),
    /changed while the agent was working/,
  );
  assert.equal((await data.loadMessages(chat.id)).length, 1);
});

test('renaming during a save keeps both changes', async () => {
  const data = new WorkspaceData(await tempFolder());
  const chat = await data.createChat('Old title');
  await Promise.all([
    data.saveRun(chat.id, {
      fromSeq: 0,
      messages: [{ role: 'user', content: 'a' }],
      plan: null,
      memoryShown: '- remembered',
    }),
    data.updateChat(chat.id, { title: 'New title' }),
  ]);
  const saved = await data.readChat(chat.id);
  assert.equal(saved?.title, 'New title');
  assert.equal(saved?.memoryShown, '- remembered');
});

test('concurrent memory writes are all kept', async () => {
  const memory = new WorkspaceData(await tempFolder()).memory();
  await Promise.all(['one', 'two', 'three', 'four'].map((fact) => memory.add(fact)));
  assert.deepEqual((await memory.all()).map((m) => m.fact).sort(), ['four', 'one', 'three', 'two']);
});

test('chat ids must be UUIDs, so they can never point outside the chats folder', async () => {
  const data = new WorkspaceData(await tempFolder());
  await assert.rejects(data.loadMessages('../../etc'), /Not a chat id/);
});

test('the data moves with the workspace, and removing it leaves the other files', async () => {
  const from = await tempFolder();
  const to = await tempFolder();
  const data = new WorkspaceData(from);
  const chat = await data.createChat('Moving');
  await data.memory().add('a fact');
  await fs.writeFile(path.join(from, 'notes.txt'), 'mine');

  await data.moveTo(to);
  const moved = new WorkspaceData(to);
  assert.equal((await moved.readChat(chat.id))?.title, 'Moving');
  assert.deepEqual(
    (await moved.memory().all()).map((m) => m.fact),
    ['a fact'],
  );
  assert.equal(await data.exists(), false, 'nothing left behind');

  await moved.remove();
  assert.equal(await moved.exists(), false);
  assert.equal(await fs.readFile(path.join(from, 'notes.txt'), 'utf8'), 'mine');
});

test("a removed workspace folder isn't silently created again", async () => {
  const folder = await tempFolder();
  await fs.rm(folder, { recursive: true });
  await assert.rejects(new WorkspaceData(folder).createChat('x'), /no longer exists/);
});

test('attachments are kept privately in uploads/ and saved with the message they came with', async () => {
  const folder = await tempFolder();
  const uploads = new WorkspaceAttachments(folder);
  const pdf = await uploads.save({
    name: '../../etc/Report.pdf',
    type: '',
    bytes: Buffer.from('%PDF'),
  });

  assert.equal(pdf.name, 'Report.pdf', 'folders are dropped from the name');
  assert.equal(pdf.type, 'application/pdf', 'the type is guessed from the name');
  assert.equal(pdf.kind, 'pdf');
  assert.deepEqual(await uploads.get(pdf.id), pdf);
  assert.equal((await uploads.read(pdf.id)).toString(), '%PDF');
  assert.ok(uploads.filePath(pdf.id).startsWith(path.join(folder, '.nimbrio-ai', 'uploads')));
  assert.ok(
    await fs.stat(path.join(folder, '.nimbrio-ai', '.gitignore')),
    'the data folder keeps itself out of git',
  );
  assert.equal(await uploads.get('not-a-uuid'), null);
  assert.equal(await uploads.get('00000000-0000-4000-8000-000000000000'), null);
  await assert.rejects(
    uploads.save({ name: 'empty.txt', type: '', bytes: Buffer.alloc(0) }),
    /empty/,
  );
  assert.equal(cleanFileName('\u0000\u0007'), 'file');

  const data = new WorkspaceData(folder);
  const chat = await data.createChat('Files');
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Look\n\n[files]', display: '', attachments: [pdf] },
    { role: 'user', content: '[images]', internal: true, images: [pdf.id] },
    { role: 'assistant', content: 'Read it.' },
  ];
  await data.saveRun(chat.id, { fromSeq: 0, messages, plan: null, memoryShown: null, run });
  const saved = await data.loadMessages(chat.id);
  assert.deepEqual(nthUser(saved, 0).attachments, [pdf]);
  assert.equal(nthUser(saved, 0).display, '', 'an empty display is kept: the message has no text');
  assert.deepEqual(nthUser(saved, 1).images, [pdf.id]);
  assert.deepEqual(historyForUi(saved)[0], {
    role: 'user',
    text: '',
    attachments: [pdf],
    skills: [],
    sentAt: null, // no run records passed
  });
});

test('a summary (context compaction) is saved, reloaded and shown as a note', async () => {
  const folder = await tempFolder();
  const data = new WorkspaceData(folder);
  const chat = await data.createChat('Long chat');
  const messages: ChatMessage[] = [
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'first' },
    { role: 'user', content: 'two' },
    { role: 'assistant', content: 'second' },
    { role: 'user', content: '[Summary…] one/first', internal: true, summaryOf: 2 },
    { role: 'assistant', content: 'third' },
  ];
  await data.saveRun(chat.id, { fromSeq: 0, messages, plan: null, memoryShown: null, run });
  const saved = await data.loadMessages(chat.id);
  assert.equal(nthUser(saved, 4).summaryOf, 2, 'kept in messages.jsonl');
  assert.equal(nthUser(saved, 0).summaryOf, undefined);
  assert.deepEqual(
    historyForUi(saved).map((item) => item.role),
    ['user', 'assistant', 'user', 'assistant', 'compaction', 'assistant'],
  );
  assert.deepEqual(historyForUi(saved)[4], { role: 'compaction', summarizedMessages: 2 });
});

test('tool results are kept and shown with their calls after a reload', async () => {
  const folder = await tempFolder();
  const data = new WorkspaceData(folder);
  const chat = await data.createChat('Tools');
  const call = (id: string, name: string) => ({
    id,
    type: 'function' as const,
    function: { name, arguments: '{"path":"a.txt"}' },
  });
  const messages: ChatMessage[] = [
    { role: 'user', content: 'read it' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [call('t1', 'read_file'), call('t2', 'read_file'), call('t3', 'read_file')],
    },
    { role: 'tool', tool_call_id: 't1', content: 'x'.repeat(5000) },
    { role: 'tool', tool_call_id: 't2', content: 'Error: no such file' },
    { role: 'assistant', content: 'Done.' },
  ];
  await data.saveRun(chat.id, { fromSeq: 0, messages, plan: null, memoryShown: null, run });
  const tools = historyForUi(await data.loadMessages(chat.id)).filter(
    (item) => item.role === 'tool',
  );
  assert.deepEqual(
    tools.map((item) => [item.ok, item.result?.length ?? null]),
    [
      [true, TOOL_RESULT_PREVIEW_CHARS],
      [false, 'Error: no such file'.length],
      [true, null],
    ],
    'a preview, an error, and a call with no saved result',
  );
});

function nthUser(messages: readonly ChatMessage[], index: number) {
  const message = messages[index];
  assert.ok(message?.role === 'user');
  return message;
}

test('earlier plans are saved with the chat and kept when a save leaves them out', async () => {
  const data = new WorkspaceData(await tempFolder());
  const chat = await data.createChat('Plans');
  assert.deepEqual(chat.earlierPlans, [], 'a new chat has none');

  const old = {
    goal: 'Old',
    doneWhen: '',
    steps: [{ text: 'a', status: 'done' as const, note: '' }],
  };
  const current = { ...old, goal: 'New', createdAt: '2026-11-04T00:00:00.000Z' };
  await data.saveRun(chat.id, {
    fromSeq: 0,
    messages: [{ role: 'user', content: 'plan it' }],
    plan: current,
    earlierPlans: [old],
    memoryShown: null,
  });
  assert.deepEqual((await data.readChat(chat.id))?.earlierPlans, [old]);
  assert.deepEqual((await data.readChat(chat.id))?.plan, current);

  await data.saveRun(chat.id, {
    fromSeq: 1,
    messages: [{ role: 'user', content: 'again' }],
    plan: current,
    memoryShown: null,
  });
  assert.deepEqual((await data.readChat(chat.id))?.earlierPlans, [old]);
});

test('a message sent mid-run is saved with its time and shown inside that run', async () => {
  const folder = await tempFolder();
  const data = new WorkspaceData(folder);
  const chat = await data.createChat('Steered');
  const sentAt = '2026-11-07T10:00:00.000Z';
  const messages: ChatMessage[] = [
    { role: 'user', content: 'Count the files' },
    { role: 'assistant', content: 'On it.' },
    {
      role: 'user',
      content: '[sent while you worked]\nOnly .ts files',
      display: 'Only .ts files',
      steeredAt: sentAt,
    },
    { role: 'assistant', content: '12 .ts files.' },
  ];
  await data.saveRun(chat.id, { fromSeq: 0, messages, plan: null, memoryShown: null, run });
  const saved = await data.loadMessages(chat.id);
  assert.equal(saved[2]?.role === 'user' ? saved[2].steeredAt : null, sentAt);

  const history = historyForUi(saved, await data.loadRuns(chat.id));
  assert.deepEqual(
    history.map((item) => item.role),
    ['user', 'assistant', 'user', 'assistant', 'meta'],
    "one run: its steps and tokens come after the agent's last answer",
  );
  assert.deepEqual(history[2], {
    role: 'user',
    text: 'Only .ts files',
    attachments: [],
    skills: [],
    sentAt,
    steer: true,
  });
});
