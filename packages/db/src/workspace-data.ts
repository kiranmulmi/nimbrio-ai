// Everything the app keeps about one workspace, stored in the workspace's own folder:
//
//   <folder>/.nimbrio-ai/
//     .gitignore                  "*", so chat history never ends up in the project's git
//     settings.json               { instructions, planning, disabledTools, voiceMode, hasTerminalTab, hasGitTab }
//     mcp.json                    the MCP servers, in the { mcpServers } shape other clients use
//     memory.json                 long-term memory (LongTermMemory from @app/agent)
//     chats/<id>/chat.json        title, current and earlier plans, the memory list the model last saw
//     chats/<id>/messages.jsonl   the conversation, one message per line, append-only
//     chats/<id>/runs.jsonl       one line per request: status, steps, tokens
//     uploads/<id>/               files attached in chats (WorkspaceAttachments, attachments.ts)
//     skills/<name>.md            the user's skills (WorkspaceSkills, workspace-skills.ts)
//
// File tools can't reach this folder (APP_DATA_FOLDER in @app/agent's guardrails).
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ATTACHMENT_KINDS,
  MODEL_CALL_KINDS,
  RUN_STATUSES,
  TOKEN_GROUPS,
  STEP_STATUSES,
  TOOL_GROUPS,
  WORKSPACE_PLANNING,
  mcpConfigSchema,
  mcpWorkspaceSchema,
  type McpConfig,
  type McpWorkspaceConfig,
  type ModelCallUsage,
  type Plan,
  type RunStatus,
  type ToolGroup,
  type Usage,
} from '@app/shared';
import {
  APP_DATA_FOLDER,
  LongTermMemory,
  errorCode,
  errorMessage,
  serialized,
  writeFileAtomic,
  type ChatMessage,
  type MemoryStore,
} from '@app/agent';
import { readJson, readText } from './json-file.js';

/** A chat as saved in its chat.json. */
export interface ChatRecord {
  id: string;
  title: string;
  /** the user renamed it, so the app no longer writes the title for them */
  isTitleCustom: boolean;
  plan: Plan | null;
  /** plans this chat had before the current one, oldest first */
  earlierPlans: Plan[];
  /** the memory list the model last saw in this chat */
  memoryShown: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

/** How one request in a chat ended, keyed in loadRuns() by the seq of the message that started it. */
export interface RunRecord {
  startSeq: number;
  status: RunStatus;
  steps: number;
  inputTokens: number;
  outputTokens: number;
  /** of inputTokens, read from the model server's prompt cache */
  cachedInputTokens: number;
  /** of inputTokens, written to the model server's prompt cache */
  cacheWriteTokens: number;
  /** each model call, in order; empty for requests saved before calls were recorded */
  calls: ModelCallUsage[];
  /** when the request started, i.e. when the user sent the message (ISO) */
  startedAt: string;
  /** when the request ended (ISO) */
  finishedAt: string;
}

/** What saveRun() records about a finished (or failed) request. */
export interface RunToSave {
  prompt: string;
  status: RunStatus;
  steps: number;
  toolsUsed: string[];
  usage: Usage;
  calls: ModelCallUsage[];
  startedAt: Date;
}

export interface SaveRunInput {
  /** how many messages the chat had when the request started */
  fromSeq: number;
  messages: readonly ChatMessage[];
  plan: Plan | null;
  /** left out: the chat keeps the earlier plans it has */
  earlierPlans?: Plan[];
  memoryShown: string | null;
  run?: RunToSave;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

// ---------- File shapes ----------

const isToolGroup = (value: string): value is ToolGroup =>
  (TOOL_GROUPS as readonly string[]).includes(value);

/**
 * Older settings.json files have one `hasCodingTabs` switch for both tabs: it becomes the
 * Terminal and Git diff switches (unless they're already set), and isn't written back.
 */
function fromCodingTabs(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || !('hasCodingTabs' in raw)) return raw;
  const { hasCodingTabs, ...rest } = raw as Record<string, unknown>;
  return { hasTerminalTab: hasCodingTabs, hasGitTab: hasCodingTabs, ...rest };
}

const settingsSchema = z.preprocess(
  fromCodingTabs,
  z.object({
    instructions: z.string().default(''),
    // A hand-edited value the app doesn't know falls back to the default, not an error.
    planning: z.enum(WORKSPACE_PLANNING).catch('default').default('default'),
    disabledTools: z
      .array(z.string())
      .catch([])
      .default([])
      .transform((groups) => [...new Set(groups.filter(isToolGroup))]),
    voiceMode: z.boolean().catch(false).default(false),
    hasTerminalTab: z.boolean().catch(false).default(false),
    hasGitTab: z.boolean().catch(false).default(false),
  }),
);
export type WorkspaceSettings = z.infer<typeof settingsSchema>;
const DEFAULT_SETTINGS: WorkspaceSettings = {
  instructions: '',
  planning: 'default',
  disabledTools: [],
  voiceMode: false,
  hasTerminalTab: false,
  hasGitTab: false,
};

const planSchema = z.object({
  goal: z.string(),
  doneWhen: z.string(),
  steps: z.array(z.object({ text: z.string(), status: z.enum(STEP_STATUSES), note: z.string() })),
  createdAt: z.string().optional(),
});

const chatSchema = z.object({
  id: z.string(),
  title: z.string(),
  isTitleCustom: z.boolean().default(false),
  plan: planSchema.nullable().default(null),
  earlierPlans: z.array(planSchema).default([]),
  memoryShown: z.string().nullable().default(null),
  createdAt: z.string().nullable().default(null),
  updatedAt: z.string().nullable().default(null),
});

/** An attached file's details: uploads/<id>/meta.json, and on the user message it came with. */
export const attachmentSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().int().nonnegative(),
  kind: z.enum(ATTACHMENT_KINDS),
  createdAt: z.string(),
});

const toolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});

const messageSchema = z.object({
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().nullable().default(''),
  tool_calls: z.array(toolCallSchema).optional(),
  tool_call_id: z.string().optional(),
  internal: z.boolean().default(false),
  display: z.string().nullable().default(null),
  /** user messages: the files attached to it, and the images shown to the model with it */
  attachments: z.array(attachmentSchema).optional(),
  /** user messages: the names of the skills the user picked for it */
  skills: z.array(z.string()).optional(),
  images: z.array(z.string()).optional(),
  /** a summary of the messages before this index (context compaction), sent in their place */
  summaryOf: z.number().int().nonnegative().optional(),
  /** user messages sent while the agent worked (steering): when they were sent */
  steeredAt: z.string().optional(),
});

const tokenGroupSchema = z.object({
  id: z.enum(TOKEN_GROUPS),
  tokens: z.number(),
  items: z.array(z.object({ label: z.string(), tokens: z.number(), count: z.number() })),
});

/** A breakdown's groups; one this version doesn't know (from a newer one) is left out. */
const tokenGroupsSchema = z
  .array(z.unknown())
  .default([])
  .transform((groups) =>
    groups.flatMap((group) => {
      const parsed = tokenGroupSchema.safeParse(group);
      return parsed.success ? [parsed.data] : [];
    }),
  );

const modelCallSchema = z.object({
  // A kind this version doesn't know (from a newer one) still counts, as a step.
  kind: z.enum(MODEL_CALL_KINDS).catch('step'),
  model: z.string().nullable().default(null),
  durationMs: z.number().default(0),
  toolCalls: z.array(z.string()).default([]),
  input: tokenGroupsSchema,
  output: tokenGroupsSchema,
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number().default(0),
  cacheWriteTokens: z.number().default(0),
});

const runSchema = z.object({
  startSeq: z.number().int(),
  prompt: z.string(),
  status: z.string(),
  steps: z.number().int(),
  toolsUsed: z.array(z.string()),
  inputTokens: z.number(),
  outputTokens: z.number(),
  // Older records have none: their counts came from the server without the cache split.
  cachedInputTokens: z.number().default(0),
  cacheWriteTokens: z.number().default(0),
  // Older records have none: only the request's totals were kept.
  calls: z.array(modelCallSchema).default([]),
  startedAt: z.string(),
  finishedAt: z.string(),
});

// ---------- One workspace's data ----------

export class WorkspaceData {
  /** <folder>/.nimbrio-ai */
  readonly dir: string;

  constructor(readonly folder: string) {
    this.dir = path.join(folder, APP_DATA_FOLDER);
  }

  async exists(): Promise<boolean> {
    return pathExists(this.dir);
  }

  /**
   * Create the data folder (and its .gitignore) before the first write. The workspace
   * folder itself must still be there: it's never silently re-created after being removed.
   */
  async ensure(): Promise<void> {
    if (!(await pathExists(this.folder))) {
      throw new Error(
        `The workspace folder ${this.folder} no longer exists. Choose another one in the workspace settings.`,
      );
    }
    await fs.mkdir(path.join(this.dir, 'chats'), { recursive: true });
    const ignore = path.join(this.dir, '.gitignore');
    if (!(await pathExists(ignore))) {
      await writeFileAtomic(
        ignore,
        "# This app's chats, memory and settings. Keep them out of git.\n*\n",
      );
    }
  }

  // ---------- Settings and memory ----------

  async readSettings(): Promise<WorkspaceSettings> {
    const raw = await readJson(this.#settingsFile);
    return raw === null
      ? { ...DEFAULT_SETTINGS, disabledTools: [] }
      : parseOrExplain(settingsSchema, raw, this.#settingsFile);
  }

  /** Saves the given settings over the current ones; the rest stay as they are. */
  async writeSettings(changes: Partial<WorkspaceSettings>): Promise<void> {
    await this.ensure();
    const current = await this.readSettings();
    await writeFileAtomic(this.#settingsFile, toJson({ ...current, ...changes }));
  }

  memory(): MemoryStore {
    return new LongTermMemory(path.join(this.dir, 'memory.json'));
  }

  // ---------- MCP servers ----------

  get mcpFile(): string {
    return path.join(this.dir, 'mcp.json');
  }

  /** Which of the app's servers are on here. An old-style file (not imported yet) turns none on. */
  async readMcpWorkspace(): Promise<McpWorkspaceConfig> {
    const raw = await readJson(this.mcpFile);
    if (raw === null || isLegacyMcp(raw)) return { enabled: [] };
    return parseOrExplain(mcpWorkspaceSchema, raw, this.mcpFile);
  }

  async writeMcpWorkspace(config: McpWorkspaceConfig): Promise<void> {
    await this.ensure();
    await writeFileAtomic(this.mcpFile, toJson(config));
  }

  /** The old mcp.json with full server settings, or null when the file is already the new kind. */
  async readLegacyMcp(): Promise<McpConfig | null> {
    const raw = await readJson(this.mcpFile);
    if (raw === null || !isLegacyMcp(raw)) return null;
    return parseOrExplain(mcpConfigSchema, raw, this.mcpFile);
  }

  /** Keeps the old file next to the new one (it may hold tokens; .nimbrio-ai stays out of git). */
  async keepLegacyMcp(): Promise<void> {
    await fs.copyFile(this.mcpFile, path.join(this.dir, 'mcp.imported.json'));
  }

  // ---------- Chats ----------

  async listChats(): Promise<ChatRecord[]> {
    const chats: ChatRecord[] = [];
    for (const id of await this.#chatIds()) {
      const chat = await this.readChat(id);
      if (chat) chats.push(chat);
    }
    return chats;
  }

  async countChats(): Promise<number> {
    return (await this.#chatIds()).length;
  }

  /** When any chat here last changed (a message saved, a rename), or null with no chats. */
  async lastChatActivity(): Promise<string | null> {
    let latest: string | null = null;
    let latestTime = -Infinity;
    for (const chat of await this.listChats()) {
      if (!chat.updatedAt) continue;
      const time = Date.parse(chat.updatedAt);
      if (time > latestTime) {
        latest = chat.updatedAt;
        latestTime = time;
      }
    }
    return latest;
  }

  async readChat(id: string): Promise<ChatRecord | null> {
    const file = this.#chatFile(id);
    const raw = await readJson(file);
    return raw === null ? null : parseOrExplain(chatSchema, raw, file);
  }

  async createChat(title: string): Promise<ChatRecord> {
    await this.ensure();
    const now = new Date().toISOString();
    const chat: ChatRecord = {
      id: randomUUID(),
      title,
      isTitleCustom: false,
      plan: null,
      earlierPlans: [],
      memoryShown: null,
      createdAt: now,
      updatedAt: now,
    };
    await fs.mkdir(this.#chatDir(chat.id), { recursive: true });
    await writeFileAtomic(this.#chatFile(chat.id), toJson(chat));
    return chat;
  }

  /** Change some fields of a chat. Null when the chat doesn't exist. */
  updateChat(
    id: string,
    changes: Partial<Omit<ChatRecord, 'id' | 'createdAt'>>,
  ): Promise<ChatRecord | null> {
    const file = this.#chatFile(id);
    return serialized(file, async () => {
      const chat = await this.readChat(id);
      if (!chat) return null;
      const updated: ChatRecord = { ...chat, ...changes };
      await writeFileAtomic(file, toJson(updated));
      return updated;
    });
  }

  async deleteChat(id: string): Promise<boolean> {
    const dir = this.#chatDir(id);
    if (!(await pathExists(dir))) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  /** The conversation of a chat, oldest first. */
  async loadMessages(id: string): Promise<ChatMessage[]> {
    const lines = await readLines(this.#messagesFile(id), messageSchema);
    return lines.map(toMessage);
  }

  /** Each request's result in a chat, keyed by the seq of the message that started it. */
  async loadRuns(id: string): Promise<Map<number, RunRecord>> {
    const lines = await readLines(this.#runsFile(id), runSchema);
    return new Map(
      lines.map((r) => [
        r.startSeq,
        {
          startSeq: r.startSeq,
          status: isRunStatus(r.status) ? r.status : 'error',
          steps: r.steps,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          cachedInputTokens: r.cachedInputTokens,
          cacheWriteTokens: r.cacheWriteTokens,
          calls: r.calls,
          startedAt: r.startedAt,
          finishedAt: r.finishedAt,
        },
      ]),
    );
  }

  /** Save the end of a request: its new messages, the chat's plan and memory state, and its record. */
  saveRun(
    id: string,
    { fromSeq, messages, plan, earlierPlans, memoryShown, run }: SaveRunInput,
  ): Promise<void> {
    return serialized(this.#chatDir(id), async () => {
      const saved = (await this.loadMessages(id)).length;
      if (saved !== fromSeq) {
        throw new Error(
          `This chat changed while the agent was working (${saved} saved messages, expected ${fromSeq}). Reload it.`,
        );
      }
      if (messages.length) {
        const lines = messages.map((m) => JSON.stringify(fromMessage(m))).join('\n');
        await fs.appendFile(this.#messagesFile(id), `${lines}\n`);
      }
      if (run) {
        const record: z.infer<typeof runSchema> = {
          startSeq: fromSeq,
          prompt: run.prompt,
          status: run.status,
          steps: run.steps,
          toolsUsed: run.toolsUsed,
          inputTokens: run.usage.inputTokens,
          outputTokens: run.usage.outputTokens,
          cachedInputTokens: run.usage.cachedInputTokens ?? 0,
          cacheWriteTokens: run.usage.cacheWriteTokens ?? 0,
          calls: run.calls.map((call) => ({
            ...call,
            cachedInputTokens: call.cachedInputTokens ?? 0,
            cacheWriteTokens: call.cacheWriteTokens ?? 0,
          })),
          startedAt: run.startedAt.toISOString(),
          finishedAt: new Date().toISOString(),
        };
        await fs.appendFile(this.#runsFile(id), `${JSON.stringify(record)}\n`);
      }
      await this.updateChat(id, {
        plan,
        ...(earlierPlans ? { earlierPlans } : {}),
        memoryShown,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  // ---------- The whole folder ----------

  /** Delete all of this workspace's chats, memory and settings. */
  async remove(): Promise<void> {
    await fs.rm(this.dir, { recursive: true, force: true });
  }

  /** Move the data to another workspace folder (which must not have any of its own). */
  async moveTo(folder: string): Promise<void> {
    if (!(await this.exists())) return;
    const target = new WorkspaceData(folder);
    try {
      await fs.rename(this.dir, target.dir);
    } catch (error) {
      if (errorCode(error) !== 'EXDEV') throw error;
      // Another disk: copy, then remove the original.
      await fs.cp(this.dir, target.dir, { recursive: true, errorOnExist: true, force: false });
      await this.remove();
    }
  }

  // ---------- Paths ----------

  get #settingsFile(): string {
    return path.join(this.dir, 'settings.json');
  }

  #chatDir(id: string): string {
    // Chat ids become folder names, so only real UUIDs are accepted.
    if (!isUuid(id)) throw new Error(`Not a chat id: ${id}`);
    return path.join(this.dir, 'chats', id.toLowerCase());
  }

  #chatFile(id: string): string {
    return path.join(this.#chatDir(id), 'chat.json');
  }

  #messagesFile(id: string): string {
    return path.join(this.#chatDir(id), 'messages.jsonl');
  }

  #runsFile(id: string): string {
    return path.join(this.#chatDir(id), 'runs.jsonl');
  }

  async #chatIds(): Promise<string[]> {
    try {
      const entries = await fs.readdir(path.join(this.dir, 'chats'), { withFileTypes: true });
      return entries.filter((e) => e.isDirectory() && isUuid(e.name)).map((e) => e.name);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return [];
      throw error;
    }
  }
}

// ---------- Helpers ----------

const isLegacyMcp = (raw: unknown): boolean =>
  typeof raw === 'object' && raw !== null && 'mcpServers' in raw;

const toJson = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

const isRunStatus = (value: string): value is RunStatus =>
  (RUN_STATUSES as readonly string[]).includes(value);

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** The lines of a .jsonl file, each checked against `schema`; [] when the file doesn't exist. */
async function readLines<S extends z.ZodTypeAny>(file: string, schema: S): Promise<z.output<S>[]> {
  const text = await readText(file);
  if (text === null) return [];
  const results: z.output<S>[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${file} line ${index + 1} is damaged: ${errorMessage(error)}`, {
        cause: error,
      });
    }
    results.push(parseOrExplain(schema, raw, `${file} line ${index + 1}`));
  }
  return results;
}

function parseOrExplain<S extends z.ZodTypeAny>(
  schema: S,
  raw: unknown,
  where: string,
): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${where} has an unexpected shape: ${parsed.error.issues[0]?.message ?? ''}`);
  }
  return parsed.data as z.output<S>;
}

function toMessage(m: z.infer<typeof messageSchema>): ChatMessage {
  const flags = { internal: m.internal, display: m.display };
  const content = m.content ?? '';
  if (m.role === 'assistant') {
    return {
      role: 'assistant',
      content,
      ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
      ...flags,
    };
  }
  if (m.role === 'tool') {
    return { role: 'tool', content, tool_call_id: m.tool_call_id ?? '', ...flags };
  }
  return {
    role: 'user',
    content,
    ...flags,
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    ...(m.skills?.length ? { skills: m.skills } : {}),
    ...(m.images?.length ? { images: m.images } : {}),
    ...(m.summaryOf !== undefined ? { summaryOf: m.summaryOf } : {}),
    ...(m.steeredAt !== undefined ? { steeredAt: m.steeredAt } : {}),
  };
}

/** A message as one line of messages.jsonl, without empty fields. */
function fromMessage(m: ChatMessage): z.input<typeof messageSchema> {
  return {
    role: m.role,
    content: m.content ?? '',
    ...(m.role === 'assistant' && m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}),
    ...(m.role === 'tool' ? { tool_call_id: m.tool_call_id } : {}),
    ...(m.internal ? { internal: true } : {}),
    // Kept even when empty: a message of attachments only shows no text.
    ...(m.display !== null && m.display !== undefined ? { display: m.display } : {}),
    ...(m.role === 'user' && m.attachments?.length ? { attachments: m.attachments } : {}),
    ...(m.role === 'user' && m.skills?.length ? { skills: m.skills } : {}),
    ...(m.role === 'user' && m.images?.length ? { images: m.images } : {}),
    ...(m.role === 'user' && m.summaryOf !== undefined ? { summaryOf: m.summaryOf } : {}),
    ...(m.role === 'user' && m.steeredAt !== undefined ? { steeredAt: m.steeredAt } : {}),
  };
}
