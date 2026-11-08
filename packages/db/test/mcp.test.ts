// Offline tests for which MCP servers a workspace turns on (.nimbrio-ai/mcp.json) and the
// approvals kept outside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { McpConfig, McpServerEntry } from '@app/shared';
import { McpTrust, mcpFingerprint } from '../src/mcp-trust.js';
import { WorkspaceData } from '../src/workspace-data.js';
import { WorkspaceMcp, runnableMcpServers } from '../src/workspace-mcp.js';

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-mcp-db-test-'));
  const folder = path.join(tmp, 'project');
  await fs.mkdir(folder);
  const trust = new McpTrust(path.join(tmp, 'home', 'mcp-trust.json'));
  const data = new WorkspaceData(folder);
  return { folder, trust, data, mcp: new WorkspaceMcp(data, trust) };
}

/** The app's servers (they live in ~/.nimbrio-ai/mcp-servers.json; here just a list). */
const servers: McpServerEntry[] = [
  { name: 'github', server: { url: 'https://example.com/mcp' } },
  { name: 'docs', server: { command: 'node', args: ['docs.js'] } },
];

test('a workspace starts with every server off, and turning one on saves just its name', async () => {
  const { folder, mcp } = await setup();
  assert.deepEqual(await mcp.read(), {
    file: path.join(folder, '.nimbrio-ai', 'mcp.json'),
    enabled: [],
    isTrusted: true,
  });
  assert.deepEqual(runnableMcpServers(servers, await mcp.read()), {}, 'off until turned on');

  const state = await mcp.setEnabled('github', true);
  assert.equal(state.isTrusted, true);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(folder, '.nimbrio-ai', 'mcp.json'), 'utf8')),
    { enabled: ['github'] },
    'no settings or tokens in the workspace folder',
  );
  assert.deepEqual(Object.keys(runnableMcpServers(servers, await mcp.read())), ['github']);

  await mcp.setEnabled('github', false);
  assert.deepEqual(runnableMcpServers(servers, await mcp.read()), {});
});

test('a file changed outside the app runs nothing until it is approved', async () => {
  const { mcp, data } = await setup();
  await mcp.setEnabled('github', true);

  // Edited by hand (or arrived with a cloned project): turns on another server.
  await fs.writeFile(data.mcpFile, JSON.stringify({ enabled: ['github', 'docs'] }));
  let state = await mcp.read();
  assert.equal(state.isTrusted, false);
  assert.deepEqual(runnableMcpServers(servers, state), {});

  // A change in the app doesn't approve the outside change along with it.
  state = await mcp.setEnabled('github', true);
  assert.equal(state.isTrusted, false);

  state = await mcp.approve();
  assert.equal(state.isTrusted, true);
  assert.deepEqual(Object.keys(runnableMcpServers(servers, state)).sort(), ['docs', 'github']);
});

test('workspace settings set the whole list at once, keeping the approval', async () => {
  const { mcp } = await setup();
  await mcp.setEnabled('github', true);
  let state = await mcp.setEnabledList(['docs', 'docs']);
  assert.deepEqual(state.enabled, ['docs'], 'replaced, without duplicates');
  assert.equal(state.isTrusted, true);
  state = await mcp.setEnabledList([]);
  assert.deepEqual(runnableMcpServers(servers, state), {});
});

test('a renamed server stays on, and a server the app no longer has is skipped', async () => {
  const { mcp } = await setup();
  await mcp.setEnabled('github', true);
  await mcp.setEnabled('gone', true);
  const state = await mcp.rename('github', 'gh');
  assert.deepEqual(state.enabled.sort(), ['gh', 'gone']);
  const renamed: McpServerEntry[] = [{ name: 'gh', server: { url: 'https://example.com/mcp' } }];
  assert.deepEqual(Object.keys(runnableMcpServers(renamed, state)), ['gh']);
});

test('an old mcp.json with full settings is read as legacy and turns nothing on', async () => {
  const { data, mcp } = await setup();
  await data.ensure();
  const legacy: McpConfig = {
    mcpServers: {
      github: { url: 'https://example.com/mcp' },
      off: { command: 'x', disabled: true },
    },
  };
  await fs.writeFile(data.mcpFile, JSON.stringify(legacy));
  assert.deepEqual(await data.readLegacyMcp(), legacy);
  assert.deepEqual((await mcp.read()).enabled, []);

  await data.keepLegacyMcp();
  await mcp.replaceApproved(['github']);
  assert.equal(await data.readLegacyMcp(), null, 'now the new kind');
  assert.deepEqual(await mcp.read(), {
    file: data.mcpFile,
    enabled: ['github'],
    isTrusted: true,
  });
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(data.dir, 'mcp.imported.json'), 'utf8')),
    legacy,
    'the old file is kept next to it',
  );
});

test('approvals follow the folder, ignore formatting and stop with forget', async () => {
  const { folder, trust } = await setup();
  const config = { enabled: ['a', 'b'] };
  await trust.trust(folder, config);
  assert.equal(await trust.isTrusted(folder, { enabled: ['a', 'b'] }), true);
  assert.notEqual(mcpFingerprint(config), mcpFingerprint({ enabled: ['a'] }));

  await trust.move(folder, '/elsewhere');
  assert.equal(await trust.isTrusted(folder, config), false);
  assert.equal(await trust.isTrusted('/elsewhere', config), true);
  await trust.forget('/elsewhere');
  assert.equal(await trust.isTrusted('/elsewhere', config), false);
});

test('a damaged mcp.json is reported with its path', async () => {
  const { mcp, data } = await setup();
  await data.ensure();
  await fs.writeFile(data.mcpFile, '{ not json');
  await assert.rejects(mcp.read(), (error: Error) => error.message.includes('mcp.json is damaged'));
});
