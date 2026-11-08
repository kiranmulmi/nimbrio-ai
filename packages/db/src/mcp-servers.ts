// The app's MCP servers, in ~/.nimbrio-ai/mcp-servers.json (written 0600: `env` and `headers`
// often hold tokens), in the { mcpServers } shape other MCP clients use. Set up once, used by
// any workspace that turns them on (WorkspaceMcp). Only this app writes them, so they need no
// approval step.
import { serialized } from '@app/agent';
import {
  MCP_SERVER_NAME,
  mcpServerConfigSchema,
  type McpServerConfig,
  type McpServerEntry,
} from '@app/shared';
import { z } from 'zod';
import { InputError } from './errors.js';
import { readJson, writePrivateJson } from './json-file.js';

const serversFileSchema = z.object({
  mcpServers: z.record(z.string(), z.unknown()).default({}),
});

export class McpServerStore {
  constructor(readonly file: string) {}

  /** In the order they were added. */
  async list(): Promise<McpServerEntry[]> {
    return this.#read();
  }

  async get(name: string): Promise<McpServerEntry | null> {
    return (await this.#read()).find((entry) => entry.name === name) ?? null;
  }

  async add(name: string, server: McpServerConfig): Promise<McpServerEntry> {
    return this.#change((servers) => {
      if (servers.some((entry) => entry.name === name)) throw nameTaken(name);
      const added = { name, server };
      return { servers: [...servers, added], result: added };
    });
  }

  /** New settings for `current`, and a new name when `name` differs. Null: no such server. */
  async replace(
    current: string,
    name: string,
    server: McpServerConfig,
  ): Promise<McpServerEntry | null> {
    return this.#change((servers) => {
      if (!servers.some((entry) => entry.name === current)) return { servers, result: null };
      if (name !== current && servers.some((entry) => entry.name === name)) throw nameTaken(name);
      const replaced = { name, server };
      return {
        servers: servers.map((entry) => (entry.name === current ? replaced : entry)),
        result: replaced,
      };
    });
  }

  async remove(name: string): Promise<boolean> {
    return this.#change((servers) => {
      const left = servers.filter((entry) => entry.name !== name);
      const isRemoved = left.length < servers.length;
      return { servers: isRemoved ? left : servers, result: isRemoved };
    });
  }

  async #read(): Promise<McpServerEntry[]> {
    const raw = await readJson(this.file);
    if (raw === null) return [];
    const parsed = serversFileSchema.safeParse(raw);
    if (!parsed.success)
      throw new Error(`${this.file} is damaged: it needs an "mcpServers" object.`);
    return Object.entries(parsed.data.mcpServers).map(([name, config]) =>
      toEntry(name, config, this.file),
    );
  }

  /** Read, change and write the file as one step, so concurrent changes can't lose each other. */
  #change<T>(
    update: (servers: McpServerEntry[]) => { servers: McpServerEntry[]; result: T },
  ): Promise<T> {
    return serialized(this.file, async () => {
      const before = await this.#read();
      const { servers, result } = update(before);
      if (servers !== before) {
        const mcpServers = Object.fromEntries(servers.map(({ name, server }) => [name, server]));
        await writePrivateJson(this.file, { mcpServers });
      }
      return result;
    });
  }
}

const nameTaken = (name: string) =>
  new InputError(`There is already an MCP server named "${name}".`);

/** One saved server, checked; the old per-workspace `disabled` flag means nothing here. */
function toEntry(name: string, config: unknown, source: string): McpServerEntry {
  if (!MCP_SERVER_NAME.test(name)) {
    throw new Error(`${source}: "${name}" isn't a valid MCP server name.`);
  }
  const parsed = mcpServerConfigSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `${source}: the MCP server "${name}" is damaged: ${parsed.error.issues[0]?.message ?? ''}`,
    );
  }
  const { disabled: _unused, ...server } = parsed.data;
  return { name, server };
}
