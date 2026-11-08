import { z } from 'zod';

// MCP servers give the agent extra tools. They are set up once for the whole app (saved in
// ~/.nimbrio-ai/mcp-servers.json), each in the `mcpServers` entry shape other MCP clients use, so a snippet from a
// server's README can be pasted in as is. Each workspace turns them on or off in
// <folder>/.nimbrio-ai/mcp.json; a new server is off everywhere until turned on.

export const MCP_TRANSPORTS = ['stdio', 'http', 'sse'] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];

export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/;
const NAME_RULE = 'Use 1-32 letters, digits, "-" or "_" for the server name.';

const keyValues = z.record(z.string(), z.string());

/** One server as saved in mcp.json. Keys other MCP clients write are kept as they are. */
export const mcpServerConfigSchema = z
  .object({
    /** Left out: "http" when there is a url, else "stdio". */
    type: z.enum(MCP_TRANSPORTS).optional(),
    command: z.string().trim().min(1).max(1024).optional(),
    args: z.array(z.string().max(4096)).max(64).optional(),
    env: keyValues.optional(),
    url: z.string().trim().max(2048).optional(),
    headers: keyValues.optional(),
    disabled: z.boolean().optional(),
    /** Tools that run without asking first. */
    autoApprove: z.array(z.string()).optional(),
  })
  .passthrough()
  .superRefine((server, ctx) => {
    const transport = mcpTransportOf(server);
    if (transport === 'stdio' && !server.command) {
      ctx.addIssue({
        code: 'custom',
        path: ['command'],
        message: 'Give the command that starts the server.',
      });
    }
    if (transport !== 'stdio' && !isHttpUrl(server.url)) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: 'Give the server URL, starting with http:// or https://.',
      });
    }
  });

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

/** The old per-workspace mcp.json (full server settings), imported into the app's list once. */
export const mcpConfigSchema = z
  .object({
    mcpServers: z
      .record(z.string().regex(MCP_SERVER_NAME, NAME_RULE), mcpServerConfigSchema)
      .default({}),
  })
  .passthrough();

export type McpConfig = z.infer<typeof mcpConfigSchema>;

/** A workspace's mcp.json now: just which of the app's servers are on there. */
export const mcpWorkspaceSchema = z
  .object({ enabled: z.array(z.string().regex(MCP_SERVER_NAME, NAME_RULE)).default([]) })
  .passthrough();

export type McpWorkspaceConfig = z.infer<typeof mcpWorkspaceSchema>;

export function mcpTransportOf(server: Pick<McpServerConfig, 'type' | 'url'>): McpTransport {
  return server.type ?? (server.url ? 'http' : 'stdio');
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------- API ----------

export const mcpServerInputSchema = z.object({
  name: z.string().trim().regex(MCP_SERVER_NAME, NAME_RULE),
  server: mcpServerConfigSchema,
});

/** From a workspace's MCP tab: `enabled` is for that workspace, `autoApprove` for the server. */
export const mcpServerPatchSchema = z.object({
  enabled: z.boolean().optional(),
  autoApprove: z.array(z.string().max(200)).max(500).optional(),
});

export type McpServerInput = z.input<typeof mcpServerInputSchema>;

/** One server as saved, for the edit form. */
export interface McpServerEntry {
  name: string;
  server: McpServerConfig;
}
export type McpServerPatch = z.input<typeof mcpServerPatchSchema>;

/** Which of the app's servers are on in one workspace, set all at once (workspace settings). */
export const mcpEnabledSchema = z.object({
  enabled: z.array(z.string().regex(MCP_SERVER_NAME, NAME_RULE)).max(200),
});

export type McpEnabledInput = z.input<typeof mcpEnabledSchema>;

/** A workspace's on/off choices without starting anything. */
export interface McpEnabled {
  enabled: string[];
  /** false when its mcp.json changed outside the app and still needs a review (MCP tab) */
  isTrusted: boolean;
}

/**
 * disabled: off in this workspace. untrusted: the workspace's mcp.json changed outside the
 * app and hasn't been approved, so nothing starts. connected / error: tried to start it.
 */
export type McpServerState = 'disabled' | 'untrusted' | 'connected' | 'error';

export interface McpToolInfo {
  name: string;
  description: string;
  isAutoApproved: boolean;
}

export interface McpServerStatus {
  name: string;
  transport: McpTransport;
  config: McpServerConfig;
  state: McpServerState;
  error: string | null;
  tools: McpToolInfo[];
}

export interface McpOverview {
  /** where this workspace's on/off choices are saved */
  file: string;
  /** false when the workspace's mcp.json changed outside the app since it was last approved */
  isTrusted: boolean;
  /** set when mcp.json can't be read (bad JSON, unexpected shape) */
  fileError: string | null;
  servers: McpServerStatus[];
}
