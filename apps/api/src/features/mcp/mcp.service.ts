import { errorMessage, type McpServerReport } from '@app/agent';
import { runnableMcpServers, type McpState } from '@app/db';
import {
  mcpTransportOf,
  type McpEnabled,
  type McpOverview,
  type McpServerEntry,
  type McpServerInput,
  type McpServerPatch,
  type McpServerStatus,
  type Workspace,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/**
 * MCP servers: set up once for the app (~/.nimbrio-ai/mcp-servers.json), turned on per workspace (its
 * .nimbrio-ai/mcp.json), started by the hub for the workspaces that use them.
 */
export function createMcpService(
  { store, mcp: hub, runs }: AppContext,
  workspaces: WorkspacesService,
) {
  /** Changing a workspace's servers stops or restarts them under a running chat. */
  async function requireIdle(workspaceId: string): Promise<Workspace> {
    const workspace = await workspaces.require(workspaceId);
    if (runs.hasRunningIn(workspace.id)) {
      throw new ConflictError(
        "A chat in this workspace is still running. Change its MCP servers when it's done.",
      );
    }
    return workspace;
  }

  /** An app-wide change affects every workspace, so no chat may be running anywhere. */
  function requireAllIdle(): void {
    if (runs.hasAny()) {
      throw new ConflictError("A chat is still running. Change MCP servers when it's done.");
    }
  }

  async function requireServer(name: string): Promise<McpServerEntry> {
    const entry = await store.mcpServers.get(name);
    if (!entry) throw new NotFoundError(`There is no MCP server named "${name}".`);
    return entry;
  }

  /** Stops a server everywhere it runs (it changed or went away). */
  async function closeEverywhere(name: string): Promise<void> {
    for (const workspace of await store.listWorkspaces()) await hub.restart(workspace.path, name);
  }

  async function overviewOf(workspace: Workspace, state: McpState): Promise<McpOverview> {
    const servers = await store.mcpServers.list();
    const reports = new Map<string, McpServerReport>(
      (await hub.connect(workspace.path, runnableMcpServers(servers, state))).map((r) => [
        r.name,
        r,
      ]),
    );
    const on = new Set(state.enabled);
    return {
      file: state.file,
      isTrusted: state.isTrusted,
      fileError: null,
      servers: servers.map(({ name, server }): McpServerStatus => {
        const report = reports.get(name);
        const autoApprove = new Set(server.autoApprove ?? []);
        return {
          name,
          transport: mcpTransportOf(server),
          config: server,
          state: !on.has(name)
            ? 'disabled'
            : !state.isTrusted
              ? 'untrusted'
              : (report?.state ?? 'error'),
          error: report?.error ?? null,
          tools: (report?.tools ?? []).map((tool) => ({
            ...tool,
            isAutoApproved: autoApprove.has(tool.name),
          })),
        };
      }),
    };
  }

  return {
    // ---------- The app's servers ----------

    list: (): Promise<McpServerEntry[]> => store.mcpServers.list(),

    get: requireServer,

    async add({ name, server }: McpServerInput): Promise<McpServerEntry> {
      if (await store.mcpServers.get(name)) {
        throw new ConflictError(`There is already an MCP server named "${name}".`);
      }
      return store.mcpServers.add(name, server);
    },

    /** New settings; a new `name` renames it, and workspaces that use it keep it on. */
    async replace(current: string, { name, server }: McpServerInput): Promise<McpServerEntry> {
      requireAllIdle();
      await requireServer(current);
      if (name !== current && (await store.mcpServers.get(name))) {
        throw new ConflictError(`There is already an MCP server named "${name}".`);
      }
      const saved = await store.mcpServers.replace(current, name, server);
      if (!saved) throw new NotFoundError(`There is no MCP server named "${current}".`);
      await closeEverywhere(current);
      if (name !== current) await store.renameMcpServer(current, name);
      return saved;
    },

    async remove(name: string): Promise<void> {
      requireAllIdle();
      await requireServer(name);
      await closeEverywhere(name);
      await store.mcpServers.remove(name);
    },

    // ---------- One workspace ----------

    /** Every server, on or off here; the ones on (and approved) are started to list tools. */
    async overview(workspaceId: string): Promise<McpOverview> {
      const workspace = await workspaces.require(workspaceId);
      const mcp = store.mcp(workspace);
      let state: McpState;
      try {
        state = await mcp.read();
      } catch (error) {
        await hub.closeWorkspace(workspace.path);
        return { file: mcp.file, isTrusted: false, fileError: errorMessage(error), servers: [] };
      }
      return overviewOf(workspace, state);
    },

    /** On/off here, and which tools run without asking (that one is app-wide). */
    async patch(workspaceId: string, name: string, patch: McpServerPatch): Promise<McpOverview> {
      const workspace = await requireIdle(workspaceId);
      const { server } = await requireServer(name);
      if (patch.autoApprove !== undefined) {
        const autoApprove = [...new Set(patch.autoApprove)];
        const { autoApprove: _old, ...rest } = server;
        await store.mcpServers.replace(
          name,
          name,
          autoApprove.length ? { ...rest, autoApprove } : rest,
        );
      }
      const mcp = store.mcp(workspace);
      const state =
        patch.enabled === undefined ? await mcp.read() : await mcp.setEnabled(name, patch.enabled);
      return overviewOf(workspace, state);
    },

    /** Which servers are on here, read without starting any (workspace settings). */
    async enabled(workspaceId: string): Promise<McpEnabled> {
      const workspace = await workspaces.require(workspaceId);
      const { enabled, isTrusted } = await store.mcp(workspace).read();
      return { enabled, isTrusted };
    },

    /**
     * Turns servers on and off here all at once. Ones turned off stop now; ones turned on
     * start when a chat or the MCP tab needs them.
     */
    async setEnabled(workspaceId: string, names: readonly string[]): Promise<McpEnabled> {
      const workspace = await requireIdle(workspaceId);
      const known = new Set((await store.mcpServers.list()).map(({ name }) => name));
      const unknown = names.find((name) => !known.has(name));
      if (unknown) throw new NotFoundError(`There is no MCP server named "${unknown}".`);
      const mcp = store.mcp(workspace);
      const before = new Set((await mcp.read()).enabled);
      const { enabled, isTrusted } = await mcp.setEnabledList(names);
      const on = new Set(enabled);
      for (const name of before) if (!on.has(name)) await hub.restart(workspace.path, name);
      return { enabled, isTrusted };
    },

    /** The user reviewed the workspace's mcp.json as it is now. */
    async approve(workspaceId: string): Promise<McpOverview> {
      const workspace = await requireIdle(workspaceId);
      return overviewOf(workspace, await store.mcp(workspace).approve());
    },

    async restart(workspaceId: string, name: string): Promise<McpOverview> {
      const workspace = await requireIdle(workspaceId);
      await requireServer(name);
      await hub.restart(workspace.path, name);
      return overviewOf(workspace, await store.mcp(workspace).read());
    },
  };
}

export type McpService = ReturnType<typeof createMcpService>;
