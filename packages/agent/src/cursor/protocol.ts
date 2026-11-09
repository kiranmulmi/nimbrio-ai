// The messages of Cursor's `agent.v1.AgentService/Run`, a two-way Connect stream: we send one
// run request (the whole conversation as one user message, our tools declared as an MCP
// server), then answer the server's requests on the same stream while it streams the reply.
// Field numbers from OmniRoute's codec (see wire.ts).
import { randomUUID } from 'node:crypto';
import {
  boolField,
  bytesField,
  bytesOf,
  decodeFields,
  decodeMapEntry,
  encodeValue,
  frame,
  messageField,
  numberOf,
  stringField,
  stringOf,
  uintField,
  type Field,
} from './wire.js';

/** The name our tools go by on Cursor's side, as one MCP server. */
export const MCP_SERVER = 'nimbrio';

export interface CursorTool {
  name: string;
  description: string;
  /** JSON Schema of the arguments. */
  parameters: unknown;
}

export interface RunRequestInput {
  /** Cursor's model id, e.g. "composer-2.5" or "claude-opus-5-5". */
  modelId: string;
  /** Extra model settings, e.g. `{ id: 'effort', value: 'high' }`. */
  parameters: { id: string; value: string }[];
  userText: string;
  tools: CursorTool[];
  conversationId?: string;
}

// ---------- the run request ----------

export function encodeRunRequest(input: RunRequestInput): Buffer {
  const conversationId = input.conversationId ?? randomUUID();
  // UserMessage { text, message_id, selected_context (empty, but required), mode = 1 }:
  // without the empty context and mode the server accepts the request and never answers.
  const userMessage = messageField(1, [
    stringField(1, input.userText),
    stringField(2, randomUUID()),
    messageField(3, []),
    uintField(4, 1),
  ]);
  const action = messageField(2, [messageField(1, [userMessage])]);
  const modelDetails = messageField(3, [
    stringField(1, input.modelId),
    stringField(3, input.modelId),
    stringField(4, input.modelId),
  ]);
  // McpTools { tools }: required even when empty.
  const mcpTools = messageField(
    4,
    input.tools.map((tool) => messageField(1, [toolDefinition(tool)])),
  );
  const requestedModel = messageField(9, [
    stringField(1, input.modelId),
    ...input.parameters.map((p) =>
      messageField(3, [stringField(1, p.id), stringField(2, p.value)]),
    ),
  ]);
  const runRequest = messageField(1, [
    messageField(1, []), // conversation state: empty, the history is in the user message
    action,
    modelDetails,
    mcpTools,
    stringField(5, conversationId),
    requestedModel,
    uintField(12, 0), // exclude_workspace_context = false
    stringField(16, conversationId), // conversation_group_id
  ]);
  return frame(runRequest);
}

/** McpToolDefinition { name, description, input_schema (Value), provider, tool_name }. */
function toolDefinition(tool: CursorTool): Buffer {
  return Buffer.concat([
    stringField(1, tool.name),
    stringField(2, tool.description),
    bytesField(3, encodeValue(tool.parameters)),
    stringField(4, MCP_SERVER),
    stringField(5, tool.name),
  ]);
}

// ---------- what the server sends ----------

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** One interaction update from the stream. */
export type Update =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool_activity' }
  | { kind: 'turn_ended'; usage: TurnUsage | null }
  | { kind: 'kv' };

const ASM_INTERACTION_UPDATE = 1;
const ASM_EXEC = 2;
const ASM_KV = 4;

export function decodeUpdates(payload: Buffer): Update[] {
  const updates: Update[] = [];
  for (const top of decodeFields(payload)) {
    if (top.wireType !== 2) continue;
    if (top.fieldNumber === ASM_KV) updates.push({ kind: 'kv' });
    if (top.fieldNumber !== ASM_INTERACTION_UPDATE) continue;
    for (const field of decodeFields(top.bytes)) {
      const update = interactionUpdate(field);
      if (update) updates.push(update);
    }
  }
  return updates;
}

function interactionUpdate(field: Field): Update | null {
  const inner = field.wireType === 2 ? decodeFields(field.bytes) : [];
  switch (field.fieldNumber) {
    case 1:
      return { kind: 'text', text: stringOf(inner, 1) };
    case 4:
      return { kind: 'thinking', text: stringOf(inner, 1) };
    case 2: // tool call started
    case 3: // tool call completed
    case 7: // partial tool call
      return { kind: 'tool_activity' };
    case 14:
      return {
        kind: 'turn_ended',
        usage:
          field.wireType === 2
            ? {
                inputTokens: numberOf(inner, 1),
                outputTokens: numberOf(inner, 2),
                cacheReadTokens: numberOf(inner, 3),
                cacheWriteTokens: numberOf(inner, 4),
              }
            : null,
      };
    default:
      return null; // heartbeats, token counts, timing
  }
}

/** A request on the key-value channel: Cursor fetching or saving a blob of the conversation. */
export type KvRequest =
  | { kind: 'get'; id: number; blobId: Buffer; metadata: Buffer | null }
  | { kind: 'set'; id: number; blobId: Buffer; data: Buffer; metadata: Buffer | null };

export function decodeKvRequest(payload: Buffer): KvRequest | null {
  const top = bytesOf(decodeFields(payload), ASM_KV);
  if (!top) return null;
  const fields = decodeFields(top);
  const id = numberOf(fields, 1);
  const metadata = bytesOf(fields, 4);
  const get = bytesOf(fields, 2);
  if (get)
    return { kind: 'get', id, blobId: bytesOf(decodeFields(get), 1) ?? Buffer.alloc(0), metadata };
  const set = bytesOf(fields, 3);
  if (!set) return null;
  const setFields = decodeFields(set);
  return {
    kind: 'set',
    id,
    blobId: bytesOf(setFields, 1) ?? Buffer.alloc(0),
    data: bytesOf(setFields, 2) ?? Buffer.alloc(0),
    metadata,
  };
}

/** Exec requests: Cursor asking the client to do something (answer, or run a tool). */
export type ExecRequest =
  | { kind: 'request_context'; id: number; execId: string }
  | { kind: 'mcp_state'; id: number; execId: string }
  | { kind: 'list_mcp_resources'; id: number; execId: string }
  | {
      kind: 'mcp';
      id: number;
      execId: string;
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
    }
  /** One of Cursor's own tools (read, shell, ...); `field` says which. We decline them. */
  | {
      kind: 'builtin';
      id: number;
      execId: string;
      field: number;
      path: string;
      command: string;
      workingDir: string;
      url: string;
    };

const EXEC_REQUEST_CONTEXT = 10;
const EXEC_MCP = 11;
const EXEC_LIST_MCP_RESOURCES = 17;
const EXEC_MCP_STATE = 36;
/** Envelope fields that aren't the request itself. */
const EXEC_ENVELOPE_FIELDS = new Set([15, 19, 57]);

export function decodeExecRequest(payload: Buffer): ExecRequest | null {
  const top = bytesOf(decodeFields(payload), ASM_EXEC);
  if (!top) return null;
  const fields = decodeFields(top);
  const id = numberOf(fields, 1);
  const execId = stringOf(fields, 15);
  const variant = fields.find(
    (f): f is Extract<Field, { wireType: 2 }> =>
      f.wireType === 2 && !EXEC_ENVELOPE_FIELDS.has(f.fieldNumber),
  );
  if (!variant) return null;
  const args = decodeFields(variant.bytes);
  switch (variant.fieldNumber) {
    case EXEC_REQUEST_CONTEXT:
      return { kind: 'request_context', id, execId };
    case EXEC_MCP_STATE:
      return { kind: 'mcp_state', id, execId };
    case EXEC_LIST_MCP_RESOURCES:
      return { kind: 'list_mcp_resources', id, execId };
    case EXEC_MCP: {
      const toolArgs: Record<string, unknown> = {};
      for (const field of args) {
        if (field.fieldNumber !== 2 || field.wireType !== 2) continue;
        const entry = decodeMapEntry(field.bytes);
        if (entry) toolArgs[entry.key] = entry.value;
      }
      return {
        kind: 'mcp',
        id,
        execId,
        toolName: stringOf(args, 5) || stringOf(args, 1),
        toolCallId: stringOf(args, 3),
        args: toolArgs,
      };
    }
    default:
      return {
        kind: 'builtin',
        id,
        execId,
        field: variant.fieldNumber,
        // Read/write/delete/ls carry a path in field 1, shell its command and folder in 1 and 2,
        // fetch its URL in 1: echoed back in the rejection.
        path: stringOf(args, 1),
        command: stringOf(args, 1),
        workingDir: stringOf(args, 2),
        url: stringOf(args, 1),
      };
  }
}

// ---------- what we send back ----------

const ACM_EXEC_CLIENT = 2;
const ACM_KV_CLIENT = 3;
const ACM_EXEC_CONTROL = 5;

function execReply(
  request: { id: number; execId: string },
  resultField: number,
  result: Buffer,
): Buffer {
  return frame(
    messageField(ACM_EXEC_CLIENT, [
      uintField(1, request.id),
      stringField(15, request.execId),
      messageField(resultField, [result]),
    ]),
  );
}

/**
 * The answer to request_context: our tools, both as RequestContext.tools (7) and as an MCP
 * descriptor (34), which is what makes them findable through Cursor's own tool lookup.
 */
export function requestContextReply(
  request: { id: number; execId: string },
  tools: CursorTool[],
): Buffer {
  const parts: Buffer[] = [];
  if (tools.length) {
    for (const tool of tools) parts.push(messageField(7, [toolDefinition(tool)]));
    parts.push(
      messageField(34, [
        boolField(1, true),
        messageField(2, [
          stringField(1, MCP_SERVER),
          stringField(2, MCP_SERVER),
          ...tools.map((tool) =>
            messageField(5, [
              stringField(1, tool.name),
              stringField(3, tool.description),
              bytesField(4, encodeValue(tool.parameters)),
            ]),
          ),
        ]),
      ]),
    );
  }
  // RequestContextResult { success { request_context } }
  return execReply(request, 10, messageField(1, [messageField(1, parts)]));
}

/** The answer to mcp_state: one ready MCP server with our tools. Cursor waits until it gets it. */
export function mcpStateReply(
  request: { id: number; execId: string },
  tools: CursorTool[],
): Buffer {
  const server = messageField(1, [
    stringField(1, MCP_SERVER),
    stringField(2, MCP_SERVER),
    ...tools.map((tool) => messageField(5, [toolDefinition(tool)])),
    stringField(7, 'ready'),
  ]);
  return execReply(request, 36, messageField(1, [server]));
}

/** We have no MCP resources, only tools: an empty success. */
export const listMcpResourcesReply = (request: { id: number; execId: string }): Buffer =>
  execReply(request, 17, messageField(1, []));

export function kvReply(request: KvRequest, blobs: Map<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  if (request.id !== 0) parts.push(uintField(1, request.id));
  if (request.kind === 'get') {
    parts.push(
      messageField(2, [
        bytesField(1, blobs.get(request.blobId.toString('hex')) ?? Buffer.alloc(0)),
      ]),
    );
  } else {
    blobs.set(request.blobId.toString('hex'), request.data);
    parts.push(messageField(3, []));
  }
  if (request.metadata?.length) parts.push(bytesField(4, request.metadata));
  return frame(messageField(ACM_KV_CLIENT, parts));
}

const DECLINED = "That tool isn't available here. Use the tools of the nimbrio MCP server instead.";

/**
 * Declines one of Cursor's own tools, so the model uses ours. The common ones get their typed
 * rejection (the model reads the reason); anything else gets the generic "exec throw".
 */
export function builtinReply(request: Extract<ExecRequest, { kind: 'builtin' }>): Buffer {
  const pathRejection = (resultField: number, rejectedField: number) =>
    execReply(
      request,
      resultField,
      messageField(rejectedField, [stringField(1, request.path), stringField(2, DECLINED)]),
    );
  const shellRejection = (resultField: number, rejectedField: number) =>
    execReply(
      request,
      resultField,
      messageField(rejectedField, [
        stringField(1, request.command),
        stringField(2, request.workingDir),
        stringField(3, DECLINED),
      ]),
    );
  const error = (resultField: number, body: Buffer[]) =>
    execReply(request, resultField, messageField(2, body));

  switch (request.field) {
    case 2: // shell
      return shellRejection(2, 4);
    case 52: // mini SWE bash, shares the shell result shape
      return shellRejection(55, 4);
    case 3: // write
      return pathRejection(3, 6);
    case 4: // delete
      return pathRejection(4, 6);
    case 7: // read
      return pathRejection(7, 3);
    case 8: // ls
      return pathRejection(8, 3);
    case 5: // grep
      return error(5, [stringField(1, DECLINED)]);
    case 9: // diagnostics: no rejection, an empty success
      return execReply(request, 9, Buffer.alloc(0));
    case 14: // shell stream: a terminal rejected event, then close the exec stream
      return Buffer.concat([
        execReply(
          request,
          14,
          messageField(5, [
            stringField(1, request.command),
            stringField(2, request.workingDir),
            stringField(3, DECLINED),
          ]),
        ),
        frame(messageField(ACM_EXEC_CONTROL, [messageField(1, [uintField(1, request.id)])])),
      ]);
    case 16: // background shell
      return shellRejection(16, 3);
    case 20: // fetch
      return error(20, [stringField(1, request.url), stringField(2, DECLINED)]);
    case 23: // write to a shell's stdin
      return error(23, [stringField(1, DECLINED)]);
    default:
      if (request.field >= 45 && request.field <= 51) {
        // PI tools: the result field is one past the request's, with an error member (2).
        return execReply(request, request.field + 1, messageField(2, [stringField(1, DECLINED)]));
      }
      return frame(
        messageField(ACM_EXEC_CONTROL, [
          messageField(2, [uintField(1, request.id), stringField(2, DECLINED)]),
        ]),
      );
  }
}

/** A Connect error frame or end-of-stream payload's message, or null when it has none. */
export function connectError(payload: Buffer): string | null {
  if (payload[0] !== 0x7b) return null; // '{'
  try {
    const parsed: unknown = JSON.parse(payload.toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null || !('error' in parsed)) return null;
    const error = (parsed as { error: unknown }).error;
    if (typeof error !== 'object' || error === null) return null;
    const { code, message, details } = error as {
      code?: unknown;
      message?: unknown;
      details?: unknown;
    };
    const detail = Array.isArray(details) ? detailTitle(details[0]) : null;
    const text = detail ?? (typeof message === 'string' ? message : '');
    return (
      [typeof code === 'string' ? code : '', text].filter(Boolean).join(': ') || 'unknown error'
    );
  } catch {
    return null;
  }
}

function detailTitle(detail: unknown): string | null {
  if (typeof detail !== 'object' || detail === null) return null;
  const debug = (detail as { debug?: { details?: { title?: unknown; detail?: unknown } } }).debug;
  const title = debug?.details?.title ?? debug?.details?.detail;
  return typeof title === 'string' && title ? title : null;
}
