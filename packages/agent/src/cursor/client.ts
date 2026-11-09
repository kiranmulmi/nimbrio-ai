// Cursor's HTTP API outside the chat stream: the model list and where the chat stream lives.
// Requests present themselves as the Cursor CLI (the headers it sends); Cursor rejects clients
// it doesn't recognise.
import { isRecord } from '../errors.js';
import { bytesOf, decodeFields, stringOf } from './wire.js';

const API_URL = 'https://api2.cursor.sh';
/** The Cursor CLI build these requests present as (OmniRoute's tested pin). */
export const CLIENT_VERSION = 'cli-2026.07.08-0c04a8a';
const REQUEST_TIMEOUT_MS = 15_000;
/** How long the chat stream's address is reused before asking again. */
const AGENT_URL_TTL_MS = 60 * 60_000;

/** What every request to Cursor carries. */
export function cursorHeaders(accessToken: string): Record<string, string> {
  return {
    authorization: `Bearer ${accessToken}`,
    'connect-protocol-version': '1',
    'user-agent': 'connect-es/1.6.1',
    'x-cursor-client-type': 'cli',
    'x-cursor-client-version': CLIENT_VERSION,
    'x-ghost-mode': 'true',
  };
}

/** A model the signed-in account can use, as Cursor lists it. */
export interface CursorModel {
  /** The id sent to Cursor, e.g. "claude-opus-5-5". */
  id: string;
  /** e.g. "Claude Opus 5.5" */
  name: string;
  /** Tokens it takes in one request (the normal mode, not Max). Null when Cursor doesn't say. */
  contextWindow: number | null;
  /** It takes a reasoning effort (an `effort` or `reasoning` setting). */
  supportsReasoning: boolean;
  supportsImages: boolean;
}

/** The models the account can use (AvailableModels, as JSON). */
export async function fetchCursorModels(
  accessToken: string,
  signal?: AbortSignal,
): Promise<CursorModel[]> {
  const response = await cursorFetch(
    '/aiserver.v1.AiService/AvailableModels',
    accessToken,
    { 'content-type': 'application/json', accept: 'application/json' },
    '{}',
    signal,
  );
  return parseCursorModels(await response.json());
}

/** The usable models in an AvailableModels answer. Exported for tests. */
export function parseCursorModels(payload: unknown): CursorModel[] {
  const list = isRecord(payload) && Array.isArray(payload['models']) ? payload['models'] : [];
  const seen = new Set<string>();
  const models: CursorModel[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = text(entry['name']) ?? text(entry['serverModelName']);
    if (!id || seen.has(id) || entry['supportsAgent'] === false) continue;
    seen.add(id);
    const limit = entry['contextTokenLimit'];
    models.push({
      id,
      name: text(entry['clientDisplayName']) ?? text(entry['inputboxShortModelName']) ?? id,
      contextWindow:
        typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? limit : null,
      supportsReasoning: parameterIds(entry).some((p) => p === 'effort' || p === 'reasoning'),
      supportsImages: entry['supportsImages'] === true,
    });
  }
  return models;
}

const agentUrls = new Map<string, { url: string; expiresAt: number }>();

/**
 * Where this account's chat stream lives (GetServerConfig names an api5.cursor.sh host). Kept
 * for an hour per token.
 */
export async function cursorAgentUrl(accessToken: string, signal?: AbortSignal): Promise<string> {
  const cached = agentUrls.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) return cached.url;
  const response = await cursorFetch(
    '/aiserver.v1.ServerConfigService/GetServerConfig',
    accessToken,
    { 'content-type': 'application/proto' },
    Buffer.alloc(0),
    signal,
  );
  const url = `${parseAgentOrigin(Buffer.from(await response.arrayBuffer()))}/agent.v1.AgentService/Run`;
  if (agentUrls.size > 20) agentUrls.clear();
  agentUrls.set(accessToken, { url, expiresAt: Date.now() + AGENT_URL_TTL_MS });
  return url;
}

/** Server config field 27 { 1: agent URL (privacy mode), 2: agent URL } → the origin. */
export function parseAgentOrigin(config: Buffer): string {
  const urls = bytesOf(decodeFields(config), 27);
  const value = urls ? stringOf(decodeFields(urls), 1) || stringOf(decodeFields(urls), 2) : '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Cursor's server config has no chat address.");
  }
  // Only ever send the token to Cursor's own chat hosts.
  const isCursorHost =
    url.hostname === 'api5.cursor.sh' || url.hostname.endsWith('.api5.cursor.sh');
  if (url.protocol !== 'https:' || !isCursorHost || url.username || url.password) {
    throw new Error("Cursor's server config names an unexpected chat address.");
  }
  return url.origin;
}

/** A failed request to Cursor, with the HTTP status. */
export class CursorHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CursorHttpError';
  }
}

async function cursorFetch(
  path: string,
  accessToken: string,
  headers: Record<string, string>,
  body: string | Buffer,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { ...cursorHeaders(accessToken), ...headers },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error("Couldn't reach Cursor. Check the connection.", { cause: error });
  }
  if (response.status === 401 || response.status === 403) {
    throw new CursorHttpError(
      'Cursor refused the sign-in. Sign in again in Settings → Model providers.',
      response.status,
    );
  }
  if (!response.ok) {
    throw new CursorHttpError(`Cursor answered ${response.status}.`, response.status);
  }
  return response;
}

function parameterIds(entry: Record<string, unknown>): string[] {
  const definitions = entry['parameterDefinitions'];
  if (!Array.isArray(definitions)) return [];
  return definitions.flatMap((d) => (isRecord(d) && typeof d['id'] === 'string' ? [d['id']] : []));
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;
