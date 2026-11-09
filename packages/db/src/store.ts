// All storage, so the rest of the app never touches the data files. There is no database:
// the app's own data (the list of workspaces, models, agent settings, MCP servers, mcp.json
// approvals, provider sign-ins) lives in ~/.nimbrio-ai/ (app-home.ts). Everything about one
// workspace (including which MCP servers are on), chats, messages, runs, memory and its
// instructions, lives in the workspace folder under .nimbrio-ai/ (workspace-data.ts).
import fs from 'node:fs/promises';
import nodePath from 'node:path';
import {
  LIMITS,
  type McpConfig,
  type McpServerConfig,
  type ToolGroup,
  type Workspace,
  type WorkspacePlanning,
} from '@app/shared';
import {
  APP_DATA_FOLDER,
  errorMessage,
  expandHome,
  prepareWorkspaceFolder,
  type ChatMessage,
  type MemoryStore,
} from '@app/agent';
import { DEFAULT_APP_HOME, appHomeFile } from './app-home.js';
import { InputError } from './errors.js';
import { moveLegacyFolders } from './legacy-folders.js';
import { WorkspaceAttachments } from './attachments.js';
import { WorkspaceSkills } from './workspace-skills.js';
import { McpServerStore } from './mcp-servers.js';
import { McpTrust } from './mcp-trust.js';
import { ModelStore } from './models.js';
import { ProviderStore } from './providers.js';
import { SettingsStore } from './settings.js';
import { WorkspaceMcp } from './workspace-mcp.js';
import { WorkspaceList, type SavedWorkspace } from './workspaces.js';
import {
  WorkspaceData,
  isUuid,
  type ChatRecord,
  type RunRecord,
  type SaveRunInput,
} from './workspace-data.js';

export interface Chat extends ChatRecord {
  workspaceId: string;
}

export class Store {
  readonly #appHome: string;
  readonly #workspaces: WorkspaceList;
  /** Which workspace each chat seen so far belongs to, so finding it again is one look. */
  readonly #chatHome = new Map<string, string>();
  readonly #mcpTrust: McpTrust;
  /** The models the agent can run on, shared by every workspace. */
  readonly models: ModelStore;
  /** How the agent behaves (limits, approvals, planning, ...), app-wide. */
  readonly settings: SettingsStore;
  /** MCP servers, set up once for every workspace (each turns them on in `mcp(workspace)`). */
  readonly mcpServers: McpServerStore;
  /** Sign-ins with model providers (Cursor), app-wide. */
  readonly providers: ProviderStore;

  /** `appHome`: the folder for the app's own settings files (default ~/.nimbrio-ai). */
  constructor({ appHome = DEFAULT_APP_HOME }: { appHome?: string } = {}) {
    this.#appHome = appHome;
    this.#workspaces = new WorkspaceList(appHomeFile(appHome, 'workspaces'));
    this.#mcpTrust = new McpTrust(appHomeFile(appHome, 'mcpTrust'));
    this.providers = new ProviderStore(appHomeFile(appHome, 'providers'));
    this.models = new ModelStore(appHomeFile(appHome, 'models'), () =>
      this.providers.cursorAccessToken(),
    );
    this.settings = new SettingsStore(appHomeFile(appHome, 'agentSettings'));
    this.mcpServers = new McpServerStore(appHomeFile(appHome, 'mcpServers'));
  }

  // ---------- Workspaces ----------

  async listWorkspaces(): Promise<Workspace[]> {
    const saved = await this.#workspaces.list();
    return Promise.all(saved.map((row) => toWorkspace(row, { withChatCount: true })));
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await this.#workspaces.get(id);
    return row ? toWorkspace(row) : null;
  }

  async findWorkspaceByName(name: string): Promise<Workspace | null> {
    const wanted = name.toLowerCase();
    const found = (await this.#workspaces.list()).find((w) => w.name.toLowerCase() === wanted);
    return found ? toWorkspace(found) : null;
  }

  /**
   * The folder is created if it doesn't exist yet. A folder that already holds
   * .nimbrio-ai data (from a workspace deleted from the list) brings its chats back.
   */
  async createWorkspace({
    name,
    path,
    instructions = '',
    planning = 'default',
    disabledTools = [],
    voiceMode = false,
    hasTerminalTab = false,
    hasGitTab = false,
  }: {
    name: string;
    path: string;
    instructions?: string;
    planning?: WorkspacePlanning;
    disabledTools?: ToolGroup[];
    voiceMode?: boolean;
    hasTerminalTab?: boolean;
    hasGitTab?: boolean;
  }): Promise<Workspace> {
    const clean = checkName(name);
    const cleanInstructions = checkInstructions(instructions);
    const folder = await checkFolder(path);
    await this.#assertCanUseFolder(folder);
    await new WorkspaceData(folder).writeSettings({
      instructions: cleanInstructions,
      planning,
      disabledTools,
      voiceMode,
      hasTerminalTab,
      hasGitTab,
    });
    return toWorkspace(await this.#workspaces.add(clean, folder));
  }

  /** A new folder takes the workspace's chats, memory and settings along with it. */
  async updateWorkspace(
    id: string,
    {
      name,
      path,
      instructions,
      planning,
      disabledTools,
      voiceMode,
      hasTerminalTab,
      hasGitTab,
    }: {
      name?: string;
      path?: string;
      instructions?: string;
      planning?: WorkspacePlanning;
      disabledTools?: ToolGroup[];
      voiceMode?: boolean;
      hasTerminalTab?: boolean;
      hasGitTab?: boolean;
    },
  ): Promise<Workspace | null> {
    const current = await this.#workspaces.get(id);
    if (!current) return null;
    const cleanName = name === undefined ? current.name : checkName(name);
    const cleanInstructions = instructions === undefined ? null : checkInstructions(instructions);
    const folder = path === undefined ? current.path : await checkFolder(path);

    const isMoving = folder !== current.path;
    if (isMoving) {
      await this.#assertCanUseFolder(folder, current);
      await new WorkspaceData(current.path).moveTo(folder);
    }

    try {
      const settings = {
        ...(cleanInstructions !== null ? { instructions: cleanInstructions } : {}),
        ...(planning !== undefined ? { planning } : {}),
        ...(disabledTools !== undefined ? { disabledTools } : {}),
        ...(voiceMode !== undefined ? { voiceMode } : {}),
        ...(hasTerminalTab !== undefined ? { hasTerminalTab } : {}),
        ...(hasGitTab !== undefined ? { hasGitTab } : {}),
      };
      if (Object.keys(settings).length) await new WorkspaceData(folder).writeSettings(settings);
      const updated = await this.#workspaces.update(id, { name: cleanName, path: folder });
      if (isMoving) await this.#mcpTrust.move(current.path, folder);
      return updated ? toWorkspace(updated) : null;
    } catch (error) {
      // Keep the data where the workspace list says the workspace is.
      if (isMoving) await new WorkspaceData(folder).moveTo(current.path).catch(() => {});
      throw error;
    }
  }

  /**
   * Why `requested` can't be the folder of the workspace `workspaceId` (or of a new one), or
   * null. Checked as the user picks a folder, so nothing is created; saving checks it again
   * along with the rest (absolute, not the disk root or home).
   */
  async folderProblem(requested: string, workspaceId?: string): Promise<string | null> {
    const expanded = expandHome(requested.trim());
    if (!nodePath.isAbsolute(expanded)) return null;
    const resolved = nodePath.resolve(expanded);
    const folder = await fs.realpath(resolved).catch(() => resolved);
    const current = workspaceId ? await this.#workspaces.get(workspaceId) : null;
    if (current?.path === folder) return null;
    try {
      await this.#assertCanUseFolder(folder, current ?? undefined);
      return null;
    } catch (error) {
      if (error instanceof InputError) return error.message;
      throw error;
    }
  }

  /**
   * Another workspace mustn't use the folder. A new workspace takes over data left there (by
   * one deleted from the list); one moving there can't, as its own data would replace it.
   */
  async #assertCanUseFolder(folder: string, moving?: SavedWorkspace): Promise<void> {
    await this.#workspaces.assertFolderFree(folder, moving?.id);
    if (moving && (await new WorkspaceData(folder).exists())) {
      throw new InputError(
        `${folder} already has its own ${APP_DATA_FOLDER} folder with another workspace's chats. Pick a different folder, or remove that one first.`,
      );
    }
  }

  /** Deletes the workspace's chats, memory and settings (its .nimbrio-ai folder). Its other files stay. */
  async deleteWorkspace(id: string): Promise<boolean> {
    const row = await this.#workspaces.get(id);
    if (!row) return false;
    await new WorkspaceData(row.path).remove();
    await this.#mcpTrust.forget(row.path);
    return this.#workspaces.remove(id);
  }

  // ---------- Chats ----------

  /** The workspace's chats, most recently active first. */
  async listChats(workspaceId: string): Promise<Chat[]> {
    const row = await this.#workspaces.get(workspaceId);
    if (!row) return [];
    const chats = await new WorkspaceData(row.path).listChats();
    for (const chat of chats) this.#chatHome.set(chat.id, row.id);
    return chats
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))
      .slice(0, 200)
      .map((chat) => ({ ...chat, workspaceId: row.id }));
  }

  async getChat(id: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    return found ? { ...found.chat, workspaceId: found.workspaceId } : null;
  }

  async createChat(workspaceId: string, title = 'New chat'): Promise<Chat> {
    const row = await this.#workspaces.get(workspaceId);
    if (!row) throw new Error("That workspace doesn't exist.");
    const chat = await new WorkspaceData(row.path).createChat(checkTitle(title));
    this.#chatHome.set(chat.id, row.id);
    return { ...chat, workspaceId: row.id };
  }

  async renameChat(id: string, title: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    if (!found) return null;
    const renamed = await found.data.updateChat(id, {
      title: checkTitle(title),
      isTitleCustom: true,
    });
    return renamed ? { ...renamed, workspaceId: found.workspaceId } : null;
  }

  /**
   * A title the app wrote (from the model), saved only while the user hasn't renamed the
   * chat. Returns the updated chat, or null when it was renamed, is gone or already has it.
   */
  async setAutoTitle(id: string, title: string): Promise<Chat | null> {
    const found = await this.#locateChat(id);
    if (!found) return null;
    const chat = await found.data.readChat(id);
    if (!chat || chat.isTitleCustom || chat.title === title) return null;
    const updated = await found.data.updateChat(id, { title: checkTitle(title) });
    return updated ? { ...updated, workspaceId: found.workspaceId } : null;
  }

  async deleteChat(id: string): Promise<boolean> {
    const found = await this.#locateChat(id);
    if (!found) return false;
    this.#chatHome.delete(id);
    return found.data.deleteChat(id);
  }

  /** The conversation of a chat, oldest first. */
  async loadMessages(chatId: string): Promise<ChatMessage[]> {
    const found = await this.#locateChat(chatId);
    return found ? found.data.loadMessages(chatId) : [];
  }

  /** Save the end of a request: its messages, the chat's plan and memory state, and its record. */
  async saveRun(chatId: string, input: SaveRunInput): Promise<void> {
    const found = await this.#locateChat(chatId);
    if (!found) throw new Error('That chat no longer exists, so this request was not saved.');
    await found.data.saveRun(chatId, input);
  }

  /** Each request's result in a chat, keyed by the seq of the message that started it. */
  async loadRuns(chatId: string): Promise<Map<number, RunRecord>> {
    const found = await this.#locateChat(chatId);
    return found ? found.data.loadRuns(chatId) : new Map();
  }

  // ---------- Memories ----------

  /** The long-term memory of one workspace: .nimbrio-ai/memory.json in its folder. */
  memory(workspace: Pick<Workspace, 'path'>): MemoryStore {
    return new WorkspaceData(workspace.path).memory();
  }

  /** Files attached in one workspace's chats: .nimbrio-ai/uploads/. */
  attachments(workspace: Pick<Workspace, 'path'>): WorkspaceAttachments {
    return new WorkspaceAttachments(workspace.path);
  }

  /** One workspace's skills: .nimbrio-ai/skills/<name>.md. */
  skills(workspace: Pick<Workspace, 'path'>): WorkspaceSkills {
    return new WorkspaceSkills(workspace.path);
  }

  /** Which MCP servers one workspace turned on: .nimbrio-ai/mcp.json, and whether it's approved. */
  mcp(workspace: Pick<Workspace, 'path'>): WorkspaceMcp {
    return new WorkspaceMcp(new WorkspaceData(workspace.path), this.#mcpTrust);
  }

  /** Renames an app-wide MCP server; workspaces that turned it on keep it on under the new name. */
  async renameMcpServer(from: string, to: string): Promise<void> {
    for (const workspace of await this.listWorkspaces()) {
      const mcp = this.mcp(workspace);
      try {
        if ((await mcp.read()).enabled.includes(from)) await mcp.rename(from, to);
      } catch {
        // A folder that's gone or unreadable: nothing to keep on there.
      }
    }
  }

  /**
   * The app's data folders had another name: move ~/.agentic-ai and each listed workspace's
   * .agentic-ai to the new one (legacy-folders.ts). Call it on start, before anything reads
   * or writes them. Returns what happened, for the log.
   */
  async moveLegacyFolders(): Promise<string[]> {
    const workspaces = await this.#workspaces.list();
    return moveLegacyFolders(
      this.#appHome,
      workspaces.map((row) => row.path),
    );
  }

  /**
   * One-time move from per-workspace server settings to the app-wide list. A workspace's old
   * mcp.json is imported only if the user had approved it; its servers are added (a name
   * already taken by different settings gets a suffix) and turned on there as they were.
   * The old file is kept as mcp.imported.json. Returns what happened, for the log.
   */
  async importLegacyMcp(): Promise<string[]> {
    const notes: string[] = [];
    for (const workspace of await this.listWorkspaces()) {
      const data = new WorkspaceData(workspace.path);
      let legacy: McpConfig | null;
      try {
        legacy = await data.readLegacyMcp();
      } catch (error) {
        notes.push(
          `${workspace.name}: the old mcp.json couldn't be read (${errorMessage(error)}).`,
        );
        continue;
      }
      if (!legacy) continue;
      await data.keepLegacyMcp();
      const isApproved = await this.#mcpTrust.isTrusted(workspace.path, legacy);
      const enabled: string[] = [];
      if (isApproved) {
        for (const [name, server] of Object.entries(legacy.mcpServers)) {
          const { disabled, ...settings } = server;
          const saved = await this.#importServer(name, settings);
          if (!disabled) enabled.push(saved);
        }
      }
      await this.mcp(workspace).replaceApproved(enabled);
      notes.push(
        isApproved
          ? `${workspace.name}: imported ${Object.keys(legacy.mcpServers).length} MCP server(s), ${enabled.length} on.`
          : `${workspace.name}: its mcp.json was never approved, so its servers weren't imported (kept in mcp.imported.json).`,
      );
    }
    return notes;
  }

  /** Adds an imported server, reusing one with the same settings; returns the name it has. */
  async #importServer(name: string, server: McpServerConfig): Promise<string> {
    for (let n = 1; n < 100; n += 1) {
      const candidate = n === 1 ? name : `${name.slice(0, 29)}_${n}`;
      const existing = await this.mcpServers.get(candidate);
      if (!existing) {
        await this.mcpServers.add(candidate, server);
        return candidate;
      }
      if (JSON.stringify(existing.server) === JSON.stringify(server)) return candidate;
    }
    throw new Error(`Couldn't find a free name for the MCP server "${name}".`);
  }

  // ---------- Internals ----------

  /** The workspace a chat lives in: the remembered one first, then every workspace folder. */
  async #locateChat(
    id: string,
  ): Promise<{ workspaceId: string; data: WorkspaceData; chat: ChatRecord } | null> {
    if (!isUuid(id)) return null;
    const rows = await this.#workspaces.list();
    const remembered = this.#chatHome.get(id);
    const ordered = [...rows].sort(
      (a, b) => Number(b.id === remembered) - Number(a.id === remembered),
    );
    for (const row of ordered) {
      const data = new WorkspaceData(row.path);
      const chat = await data.readChat(id);
      if (chat) {
        this.#chatHome.set(id, row.id);
        return { workspaceId: row.id, data, chat };
      }
    }
    this.#chatHome.delete(id);
    return null;
  }
}

// ---------- Helpers ----------

async function toWorkspace(
  row: SavedWorkspace,
  { withChatCount = false }: { withChatCount?: boolean } = {},
): Promise<Workspace> {
  const data = new WorkspaceData(row.path);
  const { instructions, planning, disabledTools, voiceMode, hasTerminalTab, hasGitTab } =
    await data.readSettings();
  return {
    id: row.id,
    name: row.name,
    instructions,
    planning,
    disabledTools,
    voiceMode,
    hasTerminalTab,
    hasGitTab,
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    ...(withChatCount
      ? {
          chatCount: await data.countChats(),
          lastActiveAt: (await data.lastChatActivity()) ?? row.updatedAt,
        }
      : {}),
  };
}

function checkName(name: unknown): string {
  const clean = String(name ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) throw new InputError('Give the workspace a name.');
  if (clean.length > LIMITS.workspaceName) {
    throw new InputError(`Keep the name under ${LIMITS.workspaceName} characters.`);
  }
  return clean;
}

function checkTitle(title: unknown): string {
  const clean =
    String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim() || 'New chat';
  return clean.length > LIMITS.chatTitle ? `${clean.slice(0, LIMITS.chatTitle - 1)}…` : clean;
}

function checkInstructions(text: unknown): string {
  const clean = String(text ?? '').trim();
  if (clean.length > LIMITS.instructions) {
    throw new InputError(`Keep instructions under ${LIMITS.instructions} characters.`);
  }
  return clean;
}

/** A usable folder for a workspace (created when missing), or an InputError saying why not. */
async function checkFolder(requested: unknown): Promise<string> {
  try {
    return await prepareWorkspaceFolder(String(requested ?? ''));
  } catch (error) {
    throw new InputError(errorMessage(error));
  }
}
