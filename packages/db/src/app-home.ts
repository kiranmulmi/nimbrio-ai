// The app's own data, global to this machine and kept in the user's home folder (there is
// no database):
//
//   ~/.nimbrio-ai/
//     workspaces.json        the list of workspaces: id, name, folder (WorkspaceList)
//     models.json            the models the agent can run on, with their API keys (ModelStore)
//     agent-settings.json    how the agent behaves: Settings -> Agent (SettingsStore)
//     mcp-servers.json       the MCP servers, in the { mcpServers } shape (McpServerStore)
//     mcp-trust.json         which workspace mcp.json files the user approved (McpTrust)
//     providers.json         sign-ins with model providers, with their tokens (ProviderStore)
//
// Files holding secrets are written 0600 (writePrivateJson). Workspaces can't be the home
// folder (prepareWorkspaceFolder), so the file tools never reach these.
import os from 'node:os';
import path from 'node:path';
import { APP_DATA_FOLDER } from '@app/agent';

export const DEFAULT_APP_HOME = path.join(os.homedir(), APP_DATA_FOLDER);

export const APP_HOME_FILES = {
  workspaces: 'workspaces.json',
  models: 'models.json',
  agentSettings: 'agent-settings.json',
  mcpServers: 'mcp-servers.json',
  mcpTrust: 'mcp-trust.json',
  providers: 'providers.json',
} as const;

export type AppHomeFile = keyof typeof APP_HOME_FILES;

export const appHomeFile = (home: string, file: AppHomeFile): string =>
  path.join(home, APP_HOME_FILES[file]);
