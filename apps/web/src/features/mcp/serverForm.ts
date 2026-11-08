import { mcpServerConfigSchema, type McpServerConfig } from '@app/shared';

/** Starting points for a new server, as they appear in mcp.json. */
export const TEMPLATES: Array<{ label: string; server: McpServerConfig }> = [
  {
    label: 'Local command',
    server: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    label: 'Remote URL',
    server: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer ' } },
  },
];

export const toJson = (server: McpServerConfig): string => JSON.stringify(server, null, 2);

export type ParsedServer =
  { server: McpServerConfig; name: string | null; skipped: number } | { error: string };

/**
 * The JSON field as one server. Takes the server's own object, or a snippet the way
 * READMEs show it: `{ "mcpServers": { name: {...} } }`, `{ "servers": ... }` or
 * `{ name: {...} }`, in which case the name comes along.
 */
export function parseServerJson(text: string): ParsedServer {
  if (!text.trim()) return { error: 'Add the server configuration.' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (cause) {
    return { error: `Not valid JSON: ${cause instanceof Error ? cause.message : String(cause)}` };
  }
  if (!isRecord(raw)) return { error: 'The configuration must be a JSON object: { … }.' };

  const list = isRecord(raw.mcpServers)
    ? raw.mcpServers
    : isRecord(raw.servers)
      ? raw.servers
      : raw;
  const isServer = 'command' in list || 'url' in list;
  const entries = isServer
    ? [[null, list] as const]
    : Object.entries(list).filter((entry): entry is [string, Record<string, unknown>] =>
        isRecord(entry[1]),
      );
  const [first, ...rest] = entries;
  if (!first) return { error: 'Give the server a "command" (local) or a "url" (remote).' };

  const parsed = mcpServerConfigSchema.safeParse(first[1]);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `"${issue.path.join('.')}": ` : '';
    return { error: `${where}${issue?.message ?? 'Unexpected configuration.'}` };
  }
  return { server: parsed.data, name: first[0], skipped: rest.length };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
