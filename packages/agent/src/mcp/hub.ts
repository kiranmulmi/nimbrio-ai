// The connections to the workspaces' MCP servers. A server starts the first time a run
// (or the MCP panel) needs it and is reused after that: local servers are often
// `npx ...` commands that take seconds to start. It restarts when its config changes,
// stops when it leaves the config or sits idle, and a failed start is retried after a pause.
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import {
  ToolListChangedNotificationSchema,
  type Tool as McpTool,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpTransportOf, type McpServerConfig } from '@app/shared';
import { errorCode, errorMessage } from '../errors.js';
import type { AgentLogger } from '../logger.js';
import type { AnyTool } from '../tools/define.js';
import { toAgentTools, type McpToolSource } from './tools.js';

export interface McpToolSummary {
  name: string;
  description: string;
}

export interface McpServerReport {
  name: string;
  state: 'connected' | 'error';
  error: string | null;
  tools: McpToolSummary[];
}

export interface McpHubOptions {
  logger?: Pick<AgentLogger, 'warn'>;
  /** starting a server and listing its tools */
  connectTimeoutMs?: number;
  /** one tool call; progress from the server restarts the clock */
  callTimeoutMs?: number;
  /** a server unused this long is stopped */
  idleMs?: number;
  /** a server that failed to start is tried again after this long */
  retryMs?: number;
}

interface Connection {
  fingerprint: string;
  client: Client | null;
  starting: Promise<void> | null;
  tools: McpTool[];
  error: string | null;
  failedAt: number;
  lastUsed: number;
  /** the last lines a local server wrote to stderr, to explain why it failed */
  stderr: string[];
}

const CLIENT_INFO = { name: 'nimbrio-ai', version: '0.1.0' };
const MAX_TOOLS_PER_SERVER = 500;
const STDERR_LINES = 20;

const key = (folder: string, name: string) => `${folder}\u0000${name}`;

export class McpHub {
  readonly #connections = new Map<string, Connection>();
  readonly #logger: Pick<AgentLogger, 'warn'> | undefined;
  readonly #connectTimeoutMs: number;
  readonly #callTimeoutMs: number;
  readonly #idleMs: number;
  readonly #retryMs: number;
  readonly #sweep: NodeJS.Timeout;

  constructor(options: McpHubOptions = {}) {
    this.#logger = options.logger;
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 30_000;
    this.#callTimeoutMs = options.callTimeoutMs ?? 120_000;
    this.#idleMs = options.idleMs ?? 15 * 60_000;
    this.#retryMs = options.retryMs ?? 30_000;
    this.#sweep = setInterval(() => void this.#closeIdle(), 60_000);
    this.#sweep.unref();
  }

  /**
   * Make sure these servers of a workspace are running (starting them if needed) and
   * stop the workspace's servers that aren't listed any more. Pass only enabled,
   * approved servers.
   */
  async connect(
    folder: string,
    servers: Readonly<Record<string, McpServerConfig>>,
  ): Promise<McpServerReport[]> {
    await this.#closeOthers(folder, new Set(Object.keys(servers)));
    return Promise.all(
      Object.entries(servers).map(async ([name, server]): Promise<McpServerReport> => {
        const connection = await this.#ensure(folder, name, server);
        return {
          name,
          state: connection.client ? 'connected' : 'error',
          error: connection.client ? null : (connection.error ?? 'Not running.'),
          tools: connection.tools.map((tool) => ({
            name: tool.name,
            description: (tool.description ?? tool.title ?? '').trim(),
          })),
        };
      }),
    );
  }

  /** The servers' tools, for createAgent({ extraTools }), and how each server is doing. */
  async tools(
    folder: string,
    servers: Readonly<Record<string, McpServerConfig>>,
  ): Promise<{ tools: AnyTool[]; reports: McpServerReport[] }> {
    const reports = await this.connect(folder, servers);
    const sources: McpToolSource[] = Object.entries(servers).flatMap(([name, server]) => {
      const connection = this.#connections.get(key(folder, name));
      if (!connection?.client) return [];
      return connection.tools.map((tool) => ({
        server: name,
        tool,
        autoApprove: server.autoApprove ?? [],
      }));
    });
    const tools = toAgentTools(sources, (name, tool, input) => {
      const server = servers[name];
      if (!server) throw new Error(`There is no MCP server named "${name}".`);
      return this.#call(folder, name, server, tool, input);
    });
    return { tools, reports };
  }

  /** Stop one server; it starts again the next time it's needed. */
  async restart(folder: string, name: string): Promise<void> {
    await this.#close(key(folder, name));
  }

  /** Stop every server of a workspace (it was deleted or moved). */
  async closeWorkspace(folder: string): Promise<void> {
    const prefix = key(folder, '');
    const ids = [...this.#connections.keys()].filter((id) => id.startsWith(prefix));
    await Promise.all(ids.map((id) => this.#close(id)));
  }

  /** Stop every server. Call before the app exits. */
  async close(): Promise<void> {
    clearInterval(this.#sweep);
    await Promise.all([...this.#connections.keys()].map((id) => this.#close(id)));
  }

  // ---------- Connections ----------

  async #ensure(folder: string, name: string, server: McpServerConfig): Promise<Connection> {
    const id = key(folder, name);
    const fingerprint = fingerprintOf(server);
    let connection = this.#connections.get(id);
    if (connection && connection.fingerprint !== fingerprint) {
      await this.#close(id);
      connection = undefined;
    }
    if (connection?.starting) {
      await connection.starting;
      return connection;
    }
    if (connection?.client) {
      connection.lastUsed = Date.now();
      return connection;
    }
    if (connection && Date.now() - connection.failedAt < this.#retryMs) return connection;

    const current: Connection = connection ?? {
      fingerprint,
      client: null,
      starting: null,
      tools: [],
      error: null,
      failedAt: 0,
      lastUsed: Date.now(),
      stderr: [],
    };
    this.#connections.set(id, current);
    current.starting = this.#start(id, current, folder, name, server).finally(() => {
      current.starting = null;
    });
    await current.starting;
    return current;
  }

  async #start(
    id: string,
    connection: Connection,
    folder: string,
    name: string,
    server: McpServerConfig,
  ): Promise<void> {
    connection.error = null;
    connection.stderr = [];
    try {
      const client = await this.#open(connection, folder, server);
      // Removed or replaced while it was starting.
      if (this.#connections.get(id) !== connection) {
        await client.close().catch(() => {});
        return;
      }
      connection.client = client;
      connection.lastUsed = Date.now();
      connection.tools = await listTools(client, this.#connectTimeoutMs);
      client.onclose = () => {
        if (connection.client !== client) return; // closed on purpose
        connection.client = null;
        connection.tools = [];
        connection.failedAt = Date.now();
        connection.error = withStderr('The server stopped.', connection.stderr);
      };
      client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
        connection.tools = await listTools(client, this.#connectTimeoutMs).catch(
          () => connection.tools,
        );
      });
    } catch (error) {
      const client = connection.client;
      connection.client = null;
      connection.tools = [];
      connection.failedAt = Date.now();
      connection.error = withStderr(explainStartError(error, server), connection.stderr);
      await client?.close().catch(() => {});
      this.#logger?.warn(`MCP server "${name}" didn't start: ${connection.error}`);
    }
  }

  async #open(connection: Connection, folder: string, server: McpServerConfig): Promise<Client> {
    const transport = mcpTransportOf(server);
    if (transport === 'stdio') {
      // The SDK starts it with only safe variables (PATH, HOME, ...) plus the configured
      // `env`, never this app's own secrets. It runs in the workspace folder.
      const stdio = new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        env: server.env,
        cwd: folder,
        stderr: 'pipe',
      });
      stdio.stderr?.on('data', (chunk: Buffer | string) => keepTail(connection.stderr, chunk));
      return this.#handshake(stdio);
    }

    const url = new URL(server.url ?? '');
    const requestInit: RequestInit = { headers: server.headers ?? {} };
    if (transport === 'sse') return this.#handshake(new SSEClientTransport(url, { requestInit }));
    try {
      return await this.#handshake(new StreamableHTTPClientTransport(url, { requestInit }));
    } catch (error) {
      // Servers from before Streamable HTTP only speak the older SSE transport.
      try {
        return await this.#handshake(new SSEClientTransport(url, { requestInit }));
      } catch {
        throw error;
      }
    }
  }

  async #handshake(transport: Transport): Promise<Client> {
    const client = new Client(CLIENT_INFO);
    try {
      await client.connect(transport, { timeout: this.#connectTimeoutMs });
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }

  async #call(
    folder: string,
    name: string,
    server: McpServerConfig,
    tool: string,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    const connection = await this.#ensure(folder, name, server);
    if (!connection.client) {
      throw new Error(`The MCP server "${name}" isn't running: ${connection.error ?? ''}`.trim());
    }
    connection.lastUsed = Date.now();
    try {
      return await connection.client.callTool({ name: tool, arguments: input }, undefined, {
        timeout: this.#callTimeoutMs,
        resetTimeoutOnProgress: true,
      });
    } finally {
      connection.lastUsed = Date.now();
    }
  }

  async #close(id: string): Promise<void> {
    const connection = this.#connections.get(id);
    if (!connection) return;
    this.#connections.delete(id);
    const client = connection.client;
    connection.client = null;
    await client?.close().catch(() => {});
  }

  async #closeOthers(folder: string, keep: ReadonlySet<string>): Promise<void> {
    const prefix = key(folder, '');
    const ids = [...this.#connections.keys()].filter(
      (id) => id.startsWith(prefix) && !keep.has(id.slice(prefix.length)),
    );
    await Promise.all(ids.map((id) => this.#close(id)));
  }

  async #closeIdle(): Promise<void> {
    const now = Date.now();
    const idle = [...this.#connections.entries()]
      .filter(([, c]) => c.client && !c.starting && now - c.lastUsed > this.#idleMs)
      .map(([id]) => id);
    await Promise.all(idle.map((id) => this.#close(id)));
  }
}

async function listTools(client: Client, timeout: number): Promise<McpTool[]> {
  if (!client.getServerCapabilities()?.tools) return [];
  const tools: McpTool[] = [];
  let cursor: string | undefined;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined, { timeout });
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor && tools.length < MAX_TOOLS_PER_SERVER);
  return tools.slice(0, MAX_TOOLS_PER_SERVER);
}

/** What makes two configs the same running server; autoApprove and disabled don't. */
function fingerprintOf(server: McpServerConfig): string {
  const { command, args, env, url, headers } = server;
  const sorted = (record: Record<string, string> | undefined) =>
    record ? Object.entries(record).sort(([a], [b]) => a.localeCompare(b)) : null;
  const identity = JSON.stringify([
    mcpTransportOf(server),
    command ?? null,
    args ?? [],
    sorted(env),
    url ?? null,
    sorted(headers),
  ]);
  return createHash('sha256').update(identity).digest('hex');
}

function explainStartError(error: unknown, server: McpServerConfig): string {
  if (errorCode(error) === 'ENOENT' && server.command) {
    return `Couldn't find the command "${server.command}". Is it installed and on your PATH?`;
  }
  return errorMessage(error);
}

function keepTail(lines: string[], chunk: Buffer | string): void {
  for (const line of String(chunk).split('\n')) {
    if (line.trim()) lines.push(line.slice(0, 300));
  }
  lines.splice(0, Math.max(0, lines.length - STDERR_LINES));
}

function withStderr(message: string, stderr: readonly string[]): string {
  return stderr.length ? `${message}\n${stderr.slice(-8).join('\n')}` : message;
}
