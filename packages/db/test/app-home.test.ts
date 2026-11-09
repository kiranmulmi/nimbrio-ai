// Offline tests for the app's own data in ~/.nimbrio-ai (here a temp folder): the workspace
// list, models, agent settings and MCP servers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_AGENT_SETTINGS } from '@app/shared';
import { appHomeFile } from '../src/app-home.js';
import { moveLegacyFolders } from '../src/legacy-folders.js';
import { McpServerStore } from '../src/mcp-servers.js';
import { ModelStore } from '../src/models.js';
import { SettingsStore } from '../src/settings.js';
import { WorkspaceList } from '../src/workspaces.js';

async function home(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'agent-app-home-test-'));
}

test('models: the first is the default, keys stay private, the default moves on', async () => {
  const dir = await home();
  const models = new ModelStore(appHomeFile(dir, 'models'));
  assert.equal(await models.settingsFor(), null);
  assert.deepEqual(await models.list(), []);

  const local = await models.create({
    name: 'Llama',
    model: 'llama3.1:8b',
    baseUrl: 'http://localhost:11434/v1/',
  });
  assert.equal(local.isDefault, true);
  assert.equal(local.baseUrl, 'http://localhost:11434/v1');
  assert.equal(local.hasApiKey, false);

  const cloud = await models.create({
    name: 'GPT',
    model: 'gpt-4.1',
    apiKey: 'sk-secret',
    supportsReasoning: true,
  });
  assert.equal(cloud.isDefault, false);
  assert.equal(cloud.hasApiKey, true);
  assert.ok(!JSON.stringify(await models.list()).includes('sk-secret'));
  assert.equal((await models.settingsFor(cloud.id))?.settings.apiKey, 'sk-secret');
  assert.equal((await models.settingsFor())?.profile.id, local.id);

  // The file holding the key is readable by this user only.
  const { mode } = await fs.stat(models.file);
  assert.equal(mode & 0o777, 0o600);

  // A left-out key is kept; an empty one removes it.
  const renamed = await models.update(cloud.id, { name: 'GPT 4.1', model: 'gpt-4.1' });
  assert.equal(renamed?.hasApiKey, true);
  assert.equal((await models.settingsFor(cloud.id))?.settings.apiKey, 'sk-secret');
  assert.equal(
    (await models.update(cloud.id, { name: 'GPT 4.1', model: 'gpt-4.1', apiKey: '' }))?.hasApiKey,
    false,
  );

  // The default can't be switched off, only handed to another model.
  assert.equal(
    (await models.update(local.id, { name: 'Llama', model: 'llama3.1:8b', isDefault: false }))
      ?.isDefault,
    true,
  );
  await models.setDefault(cloud.id);
  assert.deepEqual(
    (await models.list()).map((m) => m.isDefault),
    [false, true],
  );

  assert.equal((await models.findByName('LLAMA3.1:8b'))?.id, local.id);
  await assert.rejects(models.create({ name: '', model: 'x' }), /Give the model a name/);
  await assert.rejects(models.create({ name: 'Bad', model: 'x', baseUrl: 'ftp://x' }), /http/);

  assert.equal(await models.remove(cloud.id), true);
  assert.equal((await models.list())[0]?.isDefault, true);
  assert.equal(await models.remove(cloud.id), false);
  assert.equal(await models.get('not-a-uuid'), null);
  assert.equal(await models.update('not-a-uuid', { name: 'x', model: 'x' }), null);
});

test('models: concurrent changes are all kept, and a damaged file is reported, not replaced', async () => {
  const dir = await home();
  const models = new ModelStore(appHomeFile(dir, 'models'));
  await Promise.all(
    ['a', 'b', 'c', 'd'].map((name) => models.create({ name, model: `${name}-model` })),
  );
  const list = await models.list();
  assert.equal(list.length, 4);
  assert.equal(list.filter((m) => m.isDefault).length, 1);

  await fs.writeFile(models.file, '{ "models": [');
  await assert.rejects(models.list(), /models\.json is damaged/);
  await assert.rejects(models.create({ name: 'e', model: 'e' }), /models\.json is damaged/);
  assert.equal(await fs.readFile(models.file, 'utf8'), '{ "models": [', 'left for the user to fix');
});

test('models: a hand-edited file with no default (or two) still has exactly one', async () => {
  const dir = await home();
  const models = new ModelStore(appHomeFile(dir, 'models'));
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
  await fs.writeFile(
    models.file,
    JSON.stringify({ models: ids.map((id, i) => ({ id, name: `m${i}`, model: `m${i}` })) }),
  );
  assert.deepEqual(
    (await models.list()).map((m) => m.isDefault),
    [true, false],
  );
  await fs.writeFile(
    models.file,
    JSON.stringify({
      models: ids.map((id, i) => ({ id, name: `m${i}`, model: `m${i}`, isDefault: true })),
    }),
  );
  assert.equal((await models.settingsFor())?.profile.id, ids[0]);
});

test('agent settings: defaults until saved, validated, and lenient when read', async () => {
  const dir = await home();
  const settings = new SettingsStore(appHomeFile(dir, 'agentSettings'));
  assert.deepEqual(await settings.get(), DEFAULT_AGENT_SETTINGS);

  const saved = await settings.save({
    ...DEFAULT_AGENT_SETTINGS,
    maxSteps: 15,
    approval: 'auto',
    searxngUrl: 'http://search.local:8080/',
  });
  assert.equal(saved.maxSteps, 15);
  assert.equal(saved.searxngUrl, 'http://search.local:8080');
  assert.deepEqual(await settings.get(), saved);

  await assert.rejects(settings.save({ ...saved, maxSteps: 0 }), /Max steps must be at least 1/);
  await assert.rejects(settings.save({ ...saved, searxngUrl: 'nope' }), /http/);

  // A hand-edited file keeps the valid values and defaults the rest.
  await fs.writeFile(settings.file, '{"maxSteps": "many", "planning": "off"}');
  const read = await settings.get();
  assert.equal(read.maxSteps, DEFAULT_AGENT_SETTINGS.maxSteps);
  assert.equal(read.planning, 'off');
});

test('MCP servers: kept in order, names unique, renamed in place, saved privately', async () => {
  const dir = await home();
  const servers = new McpServerStore(appHomeFile(dir, 'mcpServers'));
  assert.deepEqual(await servers.list(), []);

  await servers.add('docs', { command: 'node', env: { TOKEN: 'secret' } });
  await servers.add('github', { url: 'https://example.com/mcp' });
  await servers.add('zed', { command: 'zed' });
  await assert.rejects(servers.add('docs', { command: 'node' }), /already an MCP server/);

  // The file is in the shape other MCP clients use.
  const saved = JSON.parse(await fs.readFile(servers.file, 'utf8')) as unknown;
  assert.deepEqual(saved, {
    mcpServers: {
      docs: { command: 'node', env: { TOKEN: 'secret' } },
      github: { url: 'https://example.com/mcp' },
      zed: { command: 'zed' },
    },
  });
  assert.equal((await fs.stat(servers.file)).mode & 0o777, 0o600);

  assert.deepEqual(await servers.replace('github', 'gh', { url: 'https://example.com/v2' }), {
    name: 'gh',
    server: { url: 'https://example.com/v2' },
  });
  assert.deepEqual(
    (await servers.list()).map((s) => s.name),
    ['docs', 'gh', 'zed'],
  );
  await assert.rejects(servers.replace('gh', 'docs', { command: 'x' }), /already an MCP server/);
  assert.equal(await servers.replace('missing', 'x', { command: 'x' }), null);

  assert.equal(await servers.remove('docs'), true);
  assert.equal(await servers.remove('docs'), false);
  assert.equal(await servers.get('docs'), null);

  // The old per-workspace `disabled` flag is dropped when read.
  await fs.writeFile(servers.file, '{"mcpServers": {"old": {"command": "x", "disabled": true}}}');
  assert.deepEqual(await servers.list(), [{ name: 'old', server: { command: 'x' } }]);

  await fs.writeFile(servers.file, '{"mcpServers": {"bad name!": {"command": "x"}}}');
  await assert.rejects(servers.list(), /isn't a valid MCP server name/);
});

test('workspaces: saved privately, one folder per workspace even when two adds race', async () => {
  const dir = await home();
  const list = new WorkspaceList(appHomeFile(dir, 'workspaces'));
  assert.deepEqual(await list.list(), []);

  const results = await Promise.allSettled([list.add('A', '/p/one'), list.add('B', '/p/one')]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['fulfilled', 'rejected'],
  );
  const [only] = await list.list();
  assert.equal(only?.name, 'A');
  assert.equal((await fs.stat(list.file)).mode & 0o777, 0o600);

  const second = await list.add('B', '/p/two');
  await assert.rejects(list.update(second.id, { name: 'B', path: '/p/one' }), /"A" already uses/);
  assert.equal((await list.update(second.id, { name: 'Bee', path: '/p/three' }))?.name, 'Bee');
  assert.equal(await list.get('not-a-uuid'), null);

  // A new list reads the same file: nothing is kept only in memory.
  const again = new WorkspaceList(list.file);
  assert.deepEqual(
    (await again.list()).map((w) => w.path),
    ['/p/one', '/p/three'],
  );
  assert.equal(await again.remove(second.id), true);
  assert.equal(await again.remove(second.id), false);

  await fs.writeFile(list.file, '{"workspaces": [{"id": "x"}]}');
  await assert.rejects(list.list(), /workspaces\.json is damaged/);
});

test('the old .agentic-ai folders move to the new name, never over newer files', async () => {
  const root = await home();
  const appHome = path.join(root, '.nimbrio-ai');
  const oldHome = path.join(root, '.agentic-ai');
  await fs.mkdir(oldHome);
  await fs.writeFile(path.join(oldHome, 'models.json'), '{"old":true}');

  // A workspace whose new folder already exists (a file in both stays put), and one without.
  const merged = path.join(root, 'merged');
  await fs.mkdir(path.join(merged, '.agentic-ai', 'chats'), { recursive: true });
  await fs.writeFile(path.join(merged, '.agentic-ai', 'memory.json'), '"old"');
  await fs.mkdir(path.join(merged, '.nimbrio-ai'));
  await fs.writeFile(path.join(merged, '.nimbrio-ai', 'memory.json'), '"new"');
  const moved = path.join(root, 'moved');
  await fs.mkdir(path.join(moved, '.agentic-ai'), { recursive: true });
  // A link isn't followed or moved.
  const linked = path.join(root, 'linked');
  await fs.mkdir(linked);
  await fs.symlink(oldHome, path.join(linked, '.agentic-ai'));

  const notes = await moveLegacyFolders(appHome, [merged, moved, linked, path.join(root, 'gone')]);
  assert.equal(notes.length, 3);
  assert.equal(await fs.readFile(path.join(appHome, 'models.json'), 'utf8'), '{"old":true}');
  await assert.rejects(fs.access(oldHome));
  assert.equal(await fs.readFile(path.join(merged, '.nimbrio-ai', 'memory.json'), 'utf8'), '"new"');
  assert.ok((await fs.stat(path.join(merged, '.nimbrio-ai', 'chats'))).isDirectory());
  assert.equal(await fs.readFile(path.join(merged, '.agentic-ai', 'memory.json'), 'utf8'), '"old"');
  assert.match(notes[1] ?? '', /except memory\.json/);
  assert.ok((await fs.stat(path.join(moved, '.nimbrio-ai'))).isDirectory());
  assert.ok((await fs.lstat(path.join(linked, '.agentic-ai'))).isSymbolicLink());

  // Nothing left to move the second time.
  assert.deepEqual(await moveLegacyFolders(appHome, [moved]), []);
});

test('models: a Cursor model keeps no server or key and runs with the Cursor sign-in token', async () => {
  const dir = await home();
  let token: string | null = 'cursor-token';
  const models = new ModelStore(appHomeFile(dir, 'models'), () => Promise.resolve(token));
  const cursor = await models.create({
    name: 'Claude Opus 5.5',
    model: 'claude-opus-5-5',
    provider: 'cursor',
    baseUrl: 'https://ignored.example.com/v1',
    apiKey: 'ignored',
    contextWindow: 300_000,
  });
  assert.equal(cursor.provider, 'cursor');
  assert.equal(cursor.baseUrl, null);
  assert.equal(cursor.hasApiKey, false);
  const resolved = await models.settingsFor(cursor.id);
  assert.equal(resolved?.settings.provider, 'cursor');
  assert.equal(resolved?.settings.apiKey, 'cursor-token');

  // Editing without a provider keeps it a Cursor model.
  const edited = await models.update(cursor.id, { name: 'Opus', model: 'claude-opus-5-5' });
  assert.equal(edited?.provider, 'cursor');
  token = null;
  assert.equal((await models.settingsFor(cursor.id))?.settings.apiKey, '');

  // Older files without a provider read as OpenAI-compatible models.
  const plain = await models.create({ name: 'GPT', model: 'gpt-4.1', apiKey: 'sk-1' });
  assert.equal(plain.provider, 'openai');
  assert.equal((await models.settingsFor(plain.id))?.settings.apiKey, 'sk-1');
});
