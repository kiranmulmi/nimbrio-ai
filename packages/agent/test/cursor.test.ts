// Offline tests for Cursor: the browser sign-in and token renewal (with a fake fetch), the
// hand-written protobuf codec, and how a conversation and Cursor's answers are translated.
// The live stream is checked by hand against Cursor; nothing here touches the network.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import {
  cursorTokens,
  isExpired,
  pollCursorLogin,
  refreshCursorToken,
  startCursorLogin,
  type CursorFetch,
} from '../src/cursor/auth.js';
import { composerReply, conversationText, toUsage } from '../src/cursor/caller.js';
import { parseAgentOrigin, parseCursorModels } from '../src/cursor/client.js';
import {
  MCP_SERVER,
  builtinReply,
  connectError,
  decodeExecRequest,
  decodeKvRequest,
  decodeUpdates,
  encodeRunRequest,
  kvReply,
  requestContextReply,
} from '../src/cursor/protocol.js';
import {
  bytesOf,
  decodeFields,
  decodeValue,
  encodeValue,
  frame,
  gzipFrame,
  messageField,
  numberOf,
  stringField,
  stringOf,
  takeFrames,
  uintField,
} from '../src/cursor/wire.js';

const jwt = (claims: Record<string, unknown>) =>
  ['header', Buffer.from(JSON.stringify(claims)).toString('base64url'), 'signature'].join('.');

const EXP = Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000);
const ACCESS = jwt({ sub: 'auth0|user_1', email: 'Me@Example.com', exp: EXP });

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers with the given responses in turn and records each request. */
function fakeFetch(...responses: (Response | Error)[]): CursorFetch & { calls: Call[] } {
  const calls: Call[] = [];
  const fn = (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  };
  return Object.assign(fn as CursorFetch, { calls });
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** The payload of a single frame. */
function onlyPayload(data: Buffer): Buffer {
  const { frames, rest } = takeFrames(data);
  assert.equal(rest.length, 0);
  assert.equal(frames.length, 1);
  const payload = frames[0]?.payload;
  assert.ok(payload);
  return payload;
}

// ---------- sign-in ----------

test('the sign-in URL carries the S256 challenge of the verifier, never the verifier', () => {
  const login = startCursorLogin();
  const url = new URL(login.loginUrl);
  assert.equal(url.origin + url.pathname, 'https://cursor.com/loginDeepControl');
  assert.equal(url.searchParams.get('uuid'), login.uuid);
  assert.equal(url.searchParams.get('mode'), 'login');
  const challenge = createHash('sha256').update(login.verifier).digest('base64url');
  assert.equal(url.searchParams.get('challenge'), challenge);
  assert.ok(!login.loginUrl.includes(login.verifier));
  assert.notEqual(startCursorLogin().verifier, login.verifier);
});

test('polling: 404 is still waiting, 200 hands over the tokens, anything else failed', async () => {
  const fetchFn = fakeFetch(
    new Response(null, { status: 404 }),
    json({ accessToken: ACCESS, refreshToken: 'refresh-1' }),
    new Response('oops', { status: 500 }),
    json({ accessToken: ACCESS }),
    new Error('offline'),
  );
  const login = { uuid: 'u-1', verifier: 'v-1' };
  assert.deepEqual(await pollCursorLogin(login, fetchFn), { status: 'pending' });
  const done = await pollCursorLogin(login, fetchFn);
  assert.equal(done.status, 'connected');
  if (done.status === 'connected') {
    assert.equal(done.tokens.refreshToken, 'refresh-1');
    assert.equal(done.tokens.accountId, 'auth0|user_1');
    assert.equal(done.tokens.email, 'me@example.com');
  }
  assert.equal((await pollCursorLogin(login, fetchFn)).status, 'failed');
  assert.equal((await pollCursorLogin(login, fetchFn)).status, 'failed');
  assert.equal((await pollCursorLogin(login, fetchFn)).status, 'failed');
  const url = new URL(fetchFn.calls[0]?.url ?? '');
  assert.equal(url.origin + url.pathname, 'https://api2.cursor.sh/auth/poll');
  assert.equal(url.searchParams.get('verifier'), 'v-1');
});

test('tokens: expiry comes from the JWT, a little early; odd tokens leave the claims empty', () => {
  const tokens = cursorTokens(ACCESS, 'refresh-1');
  assert.equal(tokens.expiresAt, new Date(EXP * 1000 - 5 * 60_000).toISOString());
  const opaque = cursorTokens('not-a-jwt', 'also-not');
  assert.deepEqual(
    { accountId: opaque.accountId, email: opaque.email, expiresAt: opaque.expiresAt },
    { accountId: null, email: null, expiresAt: null },
  );
  assert.equal(isExpired(null), false);
  assert.equal(isExpired('2000-01-01T00:00:00Z'), true);
  assert.equal(isExpired('2999-01-01T00:00:00Z'), false);
});

test('renewal: Bearer refresh token; 401 is refused; a missing refresh token keeps the old one', async () => {
  const fetchFn = fakeFetch(
    json({ accessToken: ACCESS }),
    new Response(null, { status: 401 }),
    new Response(null, { status: 503 }),
  );
  const renewed = await refreshCursorToken('refresh-1', fetchFn);
  assert.equal(renewed.status, 'renewed');
  if (renewed.status === 'renewed') assert.equal(renewed.tokens.refreshToken, 'refresh-1');
  const headers = new Headers(fetchFn.calls[0]?.init?.headers);
  assert.equal(headers.get('authorization'), 'Bearer refresh-1');
  assert.deepEqual(await refreshCursorToken('refresh-1', fetchFn), { status: 'refused' });
  assert.equal((await refreshCursorToken('refresh-1', fetchFn)).status, 'failed');
});

// ---------- wire format ----------

test('protobuf Values round-trip JSON tool schemas and arguments', () => {
  const schema = {
    type: 'object',
    properties: { path: { type: 'string' }, limit: { type: 'number' } },
    required: ['path'],
    additionalProperties: false,
    nested: [1.5, null, true, 'x'],
  };
  assert.deepEqual(decodeValue(encodeValue(schema)), schema);
  assert.equal(decodeValue(encodeValue('héllo')), 'héllo');
});

test('frames: whole frames come off the front, a partial one waits, gzip is unpacked', () => {
  const one = frame(Buffer.from('a'));
  const two = gzipFrame(Buffer.from('bb'));
  const data = Buffer.concat([one, two, frame(Buffer.from('ccc')).subarray(0, 4)]);
  const { frames, rest } = takeFrames(data);
  assert.deepEqual(
    frames.map((f) => f.payload.toString()),
    ['a', 'bb'],
  );
  assert.equal(rest.length, 4);
  const huge = Buffer.alloc(5);
  huge.writeUInt32BE(64 * 1024 * 1024, 1);
  assert.throws(() => takeFrames(huge), /oversized/);
});

// ---------- the run request and Cursor's answers ----------

test('the run request carries the text, the model with its settings and our tools', () => {
  const request = decodeFields(
    bytesOf(
      decodeFields(
        onlyPayload(
          encodeRunRequest({
            modelId: 'claude-opus-5-5',
            parameters: [{ id: 'effort', value: 'high' }],
            userText: 'hello there',
            tools: [
              { name: 'read_file', description: 'Read a file.', parameters: { type: 'object' } },
            ],
            conversationId: 'conv-1',
          }),
        ),
      ),
      1,
    ) ?? Buffer.alloc(0),
  );
  const userMessage = decodeFields(
    bytesOf(
      decodeFields(
        bytesOf(decodeFields(bytesOf(request, 2) ?? Buffer.alloc(0)), 1) ?? Buffer.alloc(0),
      ),
      1,
    ) ?? Buffer.alloc(0),
  );
  assert.equal(stringOf(userMessage, 1), 'hello there');
  assert.equal(numberOf(userMessage, 4), 1);
  assert.ok(bytesOf(userMessage, 3), 'the empty selected context is required');
  assert.equal(stringOf(request, 5), 'conv-1');
  const requested = decodeFields(bytesOf(request, 9) ?? Buffer.alloc(0));
  assert.equal(stringOf(requested, 1), 'claude-opus-5-5');
  const parameter = decodeFields(bytesOf(requested, 3) ?? Buffer.alloc(0));
  assert.deepEqual([stringOf(parameter, 1), stringOf(parameter, 2)], ['effort', 'high']);
  const tool = decodeFields(
    bytesOf(decodeFields(bytesOf(request, 4) ?? Buffer.alloc(0)), 1) ?? Buffer.alloc(0),
  );
  assert.equal(stringOf(tool, 1), 'read_file');
  assert.equal(stringOf(tool, 4), MCP_SERVER);
  assert.deepEqual(decodeValue(bytesOf(tool, 3) ?? Buffer.alloc(0)), { type: 'object' });
});

/** An AgentServerMessage carrying one exec request. */
const execMessage = (variantField: number, variant: Buffer[], id = 7, execId = 'e-1') =>
  messageField(2, [uintField(1, id), stringField(15, execId), messageField(variantField, variant)]);

test('exec requests: a tool call comes back with its name, id and JSON arguments', () => {
  const args = messageField(2, [
    stringField(1, 'city'),
    messageField(2, [encodeValue('Kathmandu')]),
  ]);
  const call = decodeExecRequest(
    execMessage(11, [
      stringField(1, 'get_weather'),
      args,
      stringField(3, 'tool_1'),
      stringField(5, 'get_weather'),
    ]),
  );
  assert.deepEqual(call, {
    kind: 'mcp',
    id: 7,
    execId: 'e-1',
    toolName: 'get_weather',
    toolCallId: 'tool_1',
    args: { city: 'Kathmandu' },
  });
  assert.deepEqual(decodeExecRequest(execMessage(10, [])), {
    kind: 'request_context',
    id: 7,
    execId: 'e-1',
  });
  assert.equal(decodeExecRequest(execMessage(36, []))?.kind, 'mcp_state');
  const shell = decodeExecRequest(execMessage(2, [stringField(1, 'ls'), stringField(2, '/tmp')]));
  assert.equal(shell?.kind, 'builtin');
  // An interaction update is not an exec request.
  assert.equal(decodeExecRequest(messageField(1, [messageField(1, [stringField(1, 'hi')])])), null);
});

test("Cursor's own tools are declined with a reason, unknown ones with the generic throw", () => {
  const shell = decodeExecRequest(
    execMessage(2, [stringField(1, 'rm -rf x'), stringField(2, '/w')]),
  );
  assert.equal(shell?.kind, 'builtin');
  if (shell?.kind !== 'builtin') return;
  const reply = decodeFields(
    bytesOf(decodeFields(onlyPayload(builtinReply(shell))), 2) ?? Buffer.alloc(0),
  );
  assert.equal(numberOf(reply, 1), 7);
  assert.equal(stringOf(reply, 15), 'e-1');
  const rejected = decodeFields(
    bytesOf(decodeFields(bytesOf(reply, 2) ?? Buffer.alloc(0)), 4) ?? Buffer.alloc(0),
  );
  assert.equal(stringOf(rejected, 1), 'rm -rf x');
  assert.match(stringOf(rejected, 3), /nimbrio/);

  const unknown = decodeExecRequest(execMessage(99, [stringField(1, 'x')]));
  if (unknown?.kind !== 'builtin') return assert.fail('expected a builtin request');
  const control = decodeFields(onlyPayload(builtinReply(unknown)));
  const thrown = decodeFields(
    bytesOf(decodeFields(bytesOf(control, 5) ?? Buffer.alloc(0)), 2) ?? Buffer.alloc(0),
  );
  assert.equal(numberOf(thrown, 1), 7);
});

test('the request-context answer declares our tools and the MCP descriptor', () => {
  const reply = decodeFields(
    onlyPayload(
      requestContextReply({ id: 3, execId: '' }, [
        { name: 'read_file', description: 'Read.', parameters: {} },
      ]),
    ),
  );
  const exec = decodeFields(bytesOf(reply, 2) ?? Buffer.alloc(0));
  const context = decodeFields(
    bytesOf(
      decodeFields(
        bytesOf(decodeFields(bytesOf(exec, 10) ?? Buffer.alloc(0)), 1) ?? Buffer.alloc(0),
      ),
      1,
    ) ?? Buffer.alloc(0),
  );
  assert.equal(stringOf(decodeFields(bytesOf(context, 7) ?? Buffer.alloc(0)), 1), 'read_file');
  const options = decodeFields(bytesOf(context, 34) ?? Buffer.alloc(0));
  assert.equal(numberOf(options, 1), 1);
  assert.equal(stringOf(decodeFields(bytesOf(options, 2) ?? Buffer.alloc(0)), 2), MCP_SERVER);
});

test('key-value requests: saved blobs are read back, with the metadata echoed', () => {
  const blobs = new Map<string, Buffer>();
  const set = decodeKvRequest(
    messageField(4, [
      uintField(1, 2),
      messageField(3, [stringField(1, 'id'), stringField(2, 'data')]),
      stringField(4, 'meta'),
    ]),
  );
  assert.equal(set?.kind, 'set');
  if (!set) return;
  kvReply(set, blobs);
  const get = decodeKvRequest(
    messageField(4, [uintField(1, 3), messageField(2, [stringField(1, 'id')])]),
  );
  assert.ok(get);
  const reply = decodeFields(
    bytesOf(decodeFields(onlyPayload(kvReply(get, blobs))), 3) ?? Buffer.alloc(0),
  );
  assert.equal(numberOf(reply, 1), 3);
  assert.equal(bytesOf(decodeFields(bytesOf(reply, 2) ?? Buffer.alloc(0)), 1)?.toString(), 'data');
});

test('updates: text, thinking, tool activity and the end of the turn with its usage', () => {
  const payload = messageField(1, [
    messageField(1, [stringField(1, 'Hello')]),
    messageField(4, [stringField(1, 'hmm')]),
    messageField(2, []),
    messageField(14, [uintField(1, 100), uintField(2, 5), uintField(4, 90)]),
    messageField(13, []), // heartbeat: ignored
  ]);
  assert.deepEqual(decodeUpdates(payload), [
    { kind: 'text', text: 'Hello' },
    { kind: 'thinking', text: 'hmm' },
    { kind: 'tool_activity' },
    {
      kind: 'turn_ended',
      usage: { inputTokens: 100, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 90 },
    },
  ]);
  // Cursor's input count already holds the cache writes.
  assert.deepEqual(
    toUsage({ inputTokens: 100, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 90 }),
    { inputTokens: 100, outputTokens: 5, cacheWriteTokens: 90 },
  );
});

test('Connect errors are read from their JSON, with the detail title when there is one', () => {
  const error = Buffer.from(
    JSON.stringify({
      error: {
        code: 'resource_exhausted',
        details: [{ debug: { details: { title: 'Out of usage' } } }],
      },
    }),
  );
  assert.equal(connectError(error), 'resource_exhausted: Out of usage');
  assert.equal(connectError(Buffer.from('{}')), null);
  assert.equal(connectError(Buffer.alloc(0)), null);
});

// ---------- translation ----------

test('the conversation becomes one labelled text, tool calls and results included', () => {
  const text = conversationText(
    {
      system: 'Be brief.',
      messages: [
        { role: 'user', content: 'Weather?' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"city":"X"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'sunny' },
      ],
    },
    true,
  );
  assert.match(text, /^The client has given you tools/);
  assert.ok(text.includes('Be brief.\n\nUser: Weather?'));
  assert.ok(text.includes('Assistant called tool get_weather (c1) with arguments: {"city":"X"}'));
  assert.ok(text.endsWith('Tool result (c1): sunny'));
  // A lone first message goes as it is.
  assert.equal(
    conversationText({ system: 'S', messages: [{ role: 'user', content: 'Hi' }] }, false),
    'S\n\nHi',
  );
});

test("Composer's reply is what follows </think>, without its final tags or a half tag", () => {
  assert.equal(composerReply('thinking...'), '');
  assert.equal(composerReply('plan</think> Hello'), 'Hello');
  assert.equal(composerReply('plan</think><|final|>Hi there<|/final|>'), 'Hi there');
  assert.equal(composerReply('plan</think><｜fin'), '');
});

test("the model list keeps Cursor's usable models with their window and settings", () => {
  const models = parseCursorModels({
    models: [
      {
        name: 'claude-opus-5-5',
        clientDisplayName: 'Claude Opus 5.5',
        contextTokenLimit: 300000,
        supportsImages: true,
        parameterDefinitions: [{ id: 'effort' }, { id: 'fast' }],
      },
      {
        name: 'composer-2.5',
        clientDisplayName: 'Composer 2.5',
        parameterDefinitions: [{ id: 'fast' }],
      },
      { name: 'tab-only', supportsAgent: false },
      { name: 'claude-opus-5-5' },
      'junk',
    ],
  });
  assert.deepEqual(models, [
    {
      id: 'claude-opus-5-5',
      name: 'Claude Opus 5.5',
      contextWindow: 300000,
      supportsReasoning: true,
      supportsImages: true,
    },
    {
      id: 'composer-2.5',
      name: 'Composer 2.5',
      contextWindow: null,
      supportsReasoning: false,
      supportsImages: false,
    },
  ]);
});

test('the chat address must be one of Cursor’s own hosts', () => {
  const config = (url: string) => messageField(27, [stringField(1, url)]);
  assert.equal(
    parseAgentOrigin(config('https://agentn.us.api5.cursor.sh')),
    'https://agentn.us.api5.cursor.sh',
  );
  assert.throws(() => parseAgentOrigin(config('https://evil.example.com')), /unexpected/);
  assert.throws(() => parseAgentOrigin(config('http://agent.api5.cursor.sh')), /unexpected/);
  assert.throws(() => parseAgentOrigin(Buffer.alloc(0)), /no chat address/);
});
