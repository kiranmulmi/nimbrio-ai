import type {
  McpEnabled,
  McpOverview,
  McpServerEntry,
  McpServerInput,
  McpServerPatch,
} from '@app/shared';
import { jsonBody, request } from '../../lib/api';

// ---------- The app's servers (Settings -> MCP servers) ----------

const serverPath = (name: string) => `/mcp/servers/${encodeURIComponent(name)}`;

export const fetchMcpServers = () => request<McpServerEntry[]>('/mcp/servers');

export const fetchMcpServer = (name: string) => request<McpServerEntry>(serverPath(name));

export const addMcpServer = (input: McpServerInput) =>
  request<McpServerEntry>('/mcp/servers', jsonBody('POST', input));

export const replaceMcpServer = (name: string, input: McpServerInput) =>
  request<McpServerEntry>(serverPath(name), jsonBody('PUT', input));

export const deleteMcpServer = (name: string) =>
  request<void>(serverPath(name), { method: 'DELETE' });

// ---------- One workspace: which are on, their tools ----------

const base = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/mcp`;
const workspaceServer = (workspaceId: string, name: string) =>
  `${base(workspaceId)}/servers/${encodeURIComponent(name)}`;

/** Starts the servers that are on (and approved) to list their tools, so it can take a moment. */
export const fetchMcpOverview = (workspaceId: string) => request<McpOverview>(base(workspaceId));

/** Which servers are on here, without starting any (the workspace form). */
export const fetchMcpEnabled = (workspaceId: string) =>
  request<McpEnabled>(`${base(workspaceId)}/enabled`);

/** Sets which servers are on here, all at once; ones turned off stop. */
export const saveMcpEnabled = (workspaceId: string, enabled: string[]) =>
  request<McpEnabled>(`${base(workspaceId)}/enabled`, jsonBody('PUT', { enabled }));

/** `enabled`: on or off in this workspace; `autoApprove`: for the server everywhere. */
export const patchMcpServer = (workspaceId: string, name: string, patch: McpServerPatch) =>
  request<McpOverview>(workspaceServer(workspaceId, name), jsonBody('PATCH', patch));

export const restartMcpServer = (workspaceId: string, name: string) =>
  request<McpOverview>(`${workspaceServer(workspaceId, name)}/restart`, jsonBody('POST', {}));

export const approveMcpConfig = (workspaceId: string) =>
  request<McpOverview>(`${base(workspaceId)}/approve`, jsonBody('POST', {}));
