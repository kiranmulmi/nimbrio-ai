// Which of the app's MCP servers one workspace has turned on: <folder>/.nimbrio-ai/mcp.json,
// `{ "enabled": ["Github", ...] }`. The file comes with the folder (a cloned project could
// carry one), so it only takes effect once approved in the app (McpTrust); changes made in
// the app keep an approved file approved.
import { serialized } from '@app/agent';
import type { McpServerConfig, McpServerEntry, McpWorkspaceConfig } from '@app/shared';
import type { McpTrust } from './mcp-trust.js';
import type { WorkspaceData } from './workspace-data.js';

export interface McpState {
  /** where the workspace's choices are saved */
  file: string;
  /** the servers turned on here, by name */
  enabled: string[];
  /** false when the file changed outside the app since it was last approved */
  isTrusted: boolean;
}

export class WorkspaceMcp {
  constructor(
    private readonly data: WorkspaceData,
    private readonly trust: McpTrust,
  ) {}

  get file(): string {
    return this.data.mcpFile;
  }

  async read(): Promise<McpState> {
    const config = await this.data.readMcpWorkspace();
    return {
      file: this.file,
      enabled: config.enabled,
      isTrusted: await this.trust.isTrusted(this.data.folder, config),
    };
  }

  /** Turns one server on or off here (a change made in the app). */
  setEnabled(name: string, isOn: boolean): Promise<McpState> {
    return this.#update((enabled) =>
      isOn ? [...new Set([...enabled, name])] : enabled.filter((item) => item !== name),
    );
  }

  /** Sets which servers are on here, all at once (a change made in the app). */
  setEnabledList(names: readonly string[]): Promise<McpState> {
    return this.#update(() => [...new Set(names)]);
  }

  /** The server was renamed app-wide: keep it on here under its new name. */
  rename(from: string, to: string): Promise<McpState> {
    return this.#update((enabled) => enabled.map((item) => (item === from ? to : item)));
  }

  /** The user reviewed the file as it is now and lets its servers start. */
  approve(): Promise<McpState> {
    return serialized(`${this.file}#app`, async () => {
      const config = await this.data.readMcpWorkspace();
      await this.trust.trust(this.data.folder, config);
      return { file: this.file, enabled: config.enabled, isTrusted: true };
    });
  }

  /** Writes the choices and approves them, e.g. after importing an old mcp.json. */
  replaceApproved(enabled: readonly string[]): Promise<void> {
    return serialized(`${this.file}#app`, async () => {
      const config: McpWorkspaceConfig = { enabled: [...enabled] };
      await this.data.writeMcpWorkspace(config);
      await this.trust.trust(this.data.folder, config);
    });
  }

  #update(change: (enabled: string[]) => string[]): Promise<McpState> {
    return serialized(`${this.file}#app`, async () => {
      const before = await this.read();
      const config: McpWorkspaceConfig = { enabled: change(before.enabled) };
      await this.data.writeMcpWorkspace(config);
      if (before.isTrusted) await this.trust.trust(this.data.folder, config);
      return {
        file: this.file,
        enabled: config.enabled,
        isTrusted: before.isTrusted || (await this.trust.isTrusted(this.data.folder, config)),
      };
    });
  }
}

/** The servers that may start in a workspace: the app's servers it turned on, once approved. */
export function runnableMcpServers(
  servers: readonly McpServerEntry[],
  state: McpState,
): Record<string, McpServerConfig> {
  if (!state.isTrusted) return {};
  const on = new Set(state.enabled);
  return Object.fromEntries(
    servers.filter(({ name }) => on.has(name)).map(({ name, server }) => [name, server]),
  );
}
