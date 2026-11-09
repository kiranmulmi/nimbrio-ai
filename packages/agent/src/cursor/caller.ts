// A model call on Cursor: one `AgentService/Run` stream per call. Cursor's agent takes a single
// user message, so the whole conversation goes in as labelled text; our tools are offered as an
// MCP server. When the model calls one, the turn ends there and the tool call is returned like
// any other model's; its result goes back in the next call's text. Cursor's own tools (read,
// shell, ...) are declined, so the model uses ours, which go through the app's approvals.
import { connect, type ClientHttp2Session, type ClientHttp2Stream } from 'node:http2';
import type { Usage } from '@app/shared';
import { StoppedError } from '../errors.js';
import type { CallModel, ModelRequest, ModelResponse, ModelSettings } from '../llm.js';
import type { ModelMessage, ToolCall } from '../memory/short-term.js';
import { cursorAgentUrl, cursorHeaders } from './client.js';
import {
  builtinReply,
  connectError,
  decodeExecRequest,
  decodeKvRequest,
  decodeUpdates,
  encodeRunRequest,
  kvReply,
  listMcpResourcesReply,
  mcpStateReply,
  requestContextReply,
  type CursorTool,
  type TurnUsage,
} from './protocol.js';
import { FLAG_END_STREAM, takeFrames } from './wire.js';

/** No frame at all (Cursor sends heartbeats while it works) for this long: give up. */
const IDLE_TIMEOUT_MS = 120_000;
/** After the first tool call, how long to wait for more in the same turn (parallel calls). */
const TOOL_CALL_GRACE_MS = 400;

/** Said before the conversation when there are tools: Cursor's models otherwise narrate. */
const TOOL_DIRECTIVE = [
  'The client has given you tools through the nimbrio MCP server.',
  'When a tool is needed, issue the actual tool call; do not describe what you are about to do and stop.',
  'Answer directly only when no tool is needed. Call each operation once, then continue after its result.',
  "Use only the nimbrio tools; Cursor's built-in tools are not available here.",
].join('\n');

export function createCursorModelCaller(settings: ModelSettings): CallModel {
  return async (request) => {
    if (!settings.apiKey) {
      throw new Error('Not signed in to Cursor. Sign in in Settings → Model providers.');
    }
    if (request.signal?.aborted) throw new StoppedError();
    const url = await cursorAgentUrl(settings.apiKey, request.signal);
    const tools: CursorTool[] = (request.tools ?? []).map(({ function: fn }) => ({
      name: fn.name,
      description: fn.description,
      parameters: fn.parameters,
    }));
    const body = encodeRunRequest({
      modelId: settings.model,
      parameters: modelParameters(settings),
      userText: conversationText(request, tools.length > 0),
      tools,
    });
    return runTurn(url, settings, body, tools, request);
  };
}

/** Reasoning effort as Cursor's setting: `reasoning` for GPT models, `effort` for the rest. */
function modelParameters(settings: ModelSettings): { id: string; value: string }[] {
  if (!settings.reasoningEffort) return [];
  const id = settings.model.startsWith('gpt-') ? 'reasoning' : 'effort';
  return [{ id, value: settings.reasoningEffort }];
}

/** The system prompt and every message as one text, the shape Cursor's models follow. */
export function conversationText(
  { system, messages }: Pick<ModelRequest, 'system' | 'messages'>,
  hasTools: boolean,
): string {
  const turns =
    messages.length === 1 && messages[0]?.role === 'user'
      ? [messages[0].content]
      : messages.flatMap(messageLines);
  return [hasTools ? TOOL_DIRECTIVE : '', system, ...turns].filter(Boolean).join('\n\n');
}

function messageLines(message: ModelMessage): string[] {
  if (message.role === 'user') return message.content ? [`User: ${message.content}`] : [];
  if (message.role === 'tool') return [`Tool result (${message.tool_call_id}): ${message.content}`];
  const lines = message.content ? [`Assistant: ${message.content}`] : [];
  for (const call of message.tool_calls ?? []) {
    lines.push(
      `Assistant called tool ${call.function.name} (${call.id}) with arguments: ${call.function.arguments}`,
    );
  }
  return lines;
}

type EndReason = 'stop' | 'tool_calls';

/** What one turn has produced so far. */
interface TurnState {
  content: string;
  /** Composer models put their reply in the thinking text, after `</think>`. */
  thinking: string;
  toolCalls: ToolCall[];
  usage: TurnUsage | null;
  /** Tool activity since the last text (Composer's end-of-turn check). */
  hasToolActivity: boolean;
  end: EndReason | null;
}

function runTurn(
  url: string,
  settings: ModelSettings,
  body: Buffer,
  tools: CursorTool[],
  { onText, signal }: ModelRequest,
): Promise<ModelResponse> {
  const isComposer = /^composer(-|$)/i.test(settings.model);
  const state: TurnState = {
    content: '',
    thinking: '',
    toolCalls: [],
    usage: null,
    hasToolActivity: false,
    end: null,
  };
  /** Blobs Cursor stores on the key-value channel during the turn and may read back. */
  const blobs = new Map<string, Buffer>();
  const seenExecs = new Set<string>();

  return new Promise((resolve, reject) => {
    const target = new URL(url);
    let session: ClientHttp2Session | undefined;
    let stream: ClientHttp2Stream | undefined;
    let buffered: Buffer = Buffer.alloc(0);
    let isSettled = false;
    let idleTimer: NodeJS.Timeout | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    const close = () => {
      clearTimeout(idleTimer);
      clearTimeout(graceTimer);
      signal?.removeEventListener('abort', onAbort);
      stream?.close();
      session?.close();
    };
    const fail = (error: unknown) => {
      if (isSettled) return;
      isSettled = true;
      close();
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const finish = () => {
      if (isSettled) return;
      isSettled = true;
      close();
      resolve(toResponse(state, settings.model));
    };
    const onAbort = () => fail(new StoppedError());
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(
        () =>
          fail(new Error(`Cursor stopped answering (no data for ${IDLE_TIMEOUT_MS / 1000} s).`)),
        IDLE_TIMEOUT_MS,
      );
    };
    const send = (data: Buffer) => {
      if (stream && !stream.destroyed) stream.write(data);
    };

    const emitText = (text: string) => {
      if (!text) return;
      state.content += text;
      state.hasToolActivity = false;
      onText?.(text);
    };

    const onExec = (payload: Buffer) => {
      const exec = decodeExecRequest(payload);
      if (!exec) return;
      const key = `${exec.kind}:${exec.execId}:${exec.id}`;
      if (seenExecs.has(key)) return;
      seenExecs.add(key);
      if (exec.kind === 'request_context') send(requestContextReply(exec, tools));
      else if (exec.kind === 'mcp_state') send(mcpStateReply(exec, tools));
      else if (exec.kind === 'list_mcp_resources') send(listMcpResourcesReply(exec));
      else if (exec.kind === 'builtin') send(builtinReply(exec));
      else {
        state.toolCalls.push({
          // GPT's ids carry a newline and a second id; keep them to one safe token.
          id:
            exec.toolCallId.replace(/[^\w-]+/g, '_') ||
            `call_${Date.now()}_${state.toolCalls.length}`,
          type: 'function',
          function: { name: exec.toolName, arguments: JSON.stringify(exec.args) },
        });
        state.end = 'tool_calls';
        // Cursor now waits for the result. Collect any parallel calls, then end the turn.
        graceTimer ??= setTimeout(finish, TOOL_CALL_GRACE_MS);
      }
    };

    const onFrame = (flags: number, payload: Buffer) => {
      if (flags & FLAG_END_STREAM || payload[0] === 0x7b) {
        const message = connectError(payload);
        if (message) fail(cursorError(message, settings));
        return;
      }
      const kv = decodeKvRequest(payload);
      if (kv) send(kvReply(kv, blobs));
      onExec(payload);
      for (const update of decodeUpdates(payload)) {
        if (update.kind === 'text') emitText(update.text);
        else if (update.kind === 'thinking' && isComposer) {
          const before = composerReply(state.thinking);
          state.thinking += update.text;
          const after = composerReply(state.thinking);
          if (after.length > before.length && after.startsWith(before)) {
            emitText(after.slice(before.length));
          }
        } else if (update.kind === 'tool_activity') state.hasToolActivity = true;
        else if (update.kind === 'turn_ended') {
          state.usage = update.usage;
          state.end ??= 'stop';
        } else if (update.kind === 'kv' && isComposer && state.content && !state.hasToolActivity) {
          // Composer saves the turn without a turn_ended once it has answered.
          state.end ??= 'stop';
        }
      }
    };

    const onData = (chunk: Buffer) => {
      resetIdle();
      buffered = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
      try {
        const { frames, rest } = takeFrames(buffered);
        buffered = rest;
        for (const { flags, payload } of frames) {
          if (isSettled || !payload.length) continue;
          onFrame(flags, payload);
        }
      } catch (error) {
        fail(error);
        return;
      }
      if (state.end === 'stop') finish();
    };

    let request: ClientHttp2Stream;
    try {
      session = connect(target.origin);
      session.on('error', fail);
      request = session.request({
        ':method': 'POST',
        ':path': target.pathname,
        ...cursorHeaders(settings.apiKey),
        'content-type': 'application/connect+proto',
        'connect-accept-encoding': 'gzip',
      });
      stream = request;
    } catch (error) {
      fail(error);
      return;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    request.on('response', (headers) => {
      const status = Number(headers[':status'] ?? 0);
      if (status === 401 || status === 403) {
        fail(new Error('Cursor refused the sign-in. Sign in again in Settings → Model providers.'));
      } else if (status !== 200) {
        fail(new Error(`Cursor answered ${status} to "${settings.label}".`));
      }
    });
    request.on('data', onData);
    request.on('error', fail);
    request.on('end', () => {
      if (state.content || state.toolCalls.length) finish();
      else fail(new Error(`Cursor ended the turn without a reply from "${settings.label}".`));
    });
    resetIdle();
    // A two-way stream: the request stays open so we can answer Cursor's requests on it.
    request.write(body);
  });
}

/** Composer's visible reply: what follows the last `</think>`, without its `<|final|>` tags. */
export function composerReply(thinking: string): string {
  const end = thinking.lastIndexOf('</think>');
  if (end < 0) return '';
  const visible = thinking.slice(end + '</think>'.length).trimStart();
  // Hold back a tag that's still arriving, so no fragment of it is shown.
  if (/^<[｜|][^>]*$/.test(visible) || visible === '<') return '';
  return visible
    .replace(/^<[｜|]\s*final\s*[｜|]>\s*/i, '')
    .replace(/\s*<[｜|]\s*\/\s*final\s*[｜|]>\s*$/i, '');
}

function toResponse(state: TurnState, model: string): ModelResponse {
  return {
    message: {
      role: 'assistant',
      content: state.content,
      tool_calls: state.toolCalls,
    },
    finishReason: state.toolCalls.length ? 'tool_calls' : 'stop',
    usage: toUsage(state.usage),
    model,
  };
}

/** Cursor's input count already includes the cache (as `readUsage` treats `prompt_tokens`). */
export function toUsage(usage: TurnUsage | null): Usage {
  if (!usage) return { inputTokens: 0, outputTokens: 0 };
  const cached = usage.cacheReadTokens + usage.cacheWriteTokens;
  return {
    inputTokens: usage.inputTokens >= cached ? usage.inputTokens : usage.inputTokens + cached,
    outputTokens: usage.outputTokens,
    ...(usage.cacheReadTokens ? { cachedInputTokens: usage.cacheReadTokens } : {}),
    ...(usage.cacheWriteTokens ? { cacheWriteTokens: usage.cacheWriteTokens } : {}),
  };
}

function cursorError(message: string, settings: ModelSettings): Error {
  const lower = message.toLowerCase();
  if (lower.includes('unauthenticated') || lower.includes('unauthorized')) {
    return new Error('Cursor refused the sign-in. Sign in again in Settings → Model providers.');
  }
  if (lower.includes('not found') && lower.includes('model')) {
    return new Error(`Cursor doesn't know the model "${settings.model}" (${settings.label}).`);
  }
  if (lower.includes('rate') || lower.includes('quota') || lower.includes('usage')) {
    return new Error(`Cursor's usage limit: ${message}`);
  }
  return new Error(`Cursor: ${message}`);
}
