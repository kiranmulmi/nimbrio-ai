import type { AgentConfig, AgentLogger, BackgroundTasks, McpHub } from '@app/agent';
import type { Store } from '@app/db';
import type { RunRegistry } from './features/runs/run-registry.js';
import type { AppSettings } from './features/settings/app-settings.js';

/** What every feature needs, built once at startup and passed to the routers. */
export interface AppContext {
  store: Store;
  /** The env part of the agent config; runs put `settings` over it (`settings.configFor`). */
  agentConfig: AgentConfig;
  /** The agent's settings from Settings -> Agent. */
  settings: AppSettings;
  agentLogger: AgentLogger;
  runs: RunRegistry;
  /** the workspaces' running MCP servers */
  mcp: McpHub;
  /** commands the agent left running on purpose (run_command background), per workspace */
  tasks: BackgroundTasks;
}
