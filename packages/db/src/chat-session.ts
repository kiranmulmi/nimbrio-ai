// Runs one request in a saved chat: load the chat's state from the workspace folder
// (.nimbrio-ai/), let the agent work with the workspace's memory, files and
// instructions, then save what happened. Shared by the API server and the CLI.
import {
  createAgent,
  errorMessage,
  isRecord,
  Planner,
  Conversation,
  type AgentRunOptions,
  type AnyTool,
  type BackgroundTasks,
  type ChatMessage,
  type McpHub,
} from '@app/agent';
import {
  toolResultPreview,
  type Attachment,
  type HistoryItem,
  type Plan,
  type RunResult,
  type Skill,
  type Workspace,
} from '@app/shared';
import type { Chat, Store } from './store.js';
import type { RunRecord } from './workspace-data.js';
import { runnableMcpServers } from './workspace-mcp.js';

export interface RunInChatArgs {
  store: Store;
  /** from store.getWorkspace() */
  workspace: Workspace;
  /** from store.getChat() / createChat() */
  chat: Chat;
  prompt: string;
  /** files attached to the prompt, from store.attachments(workspace) */
  attachments?: readonly Attachment[];
  /** skills the user picked for the prompt, from store.skills(workspace) */
  skills?: readonly Skill[];
  /** passed to createAgent: approve, ask, onEvent, logger, callModel, config */
  agentOptions?: AgentRunOptions;
  /** runs the workspace's MCP servers; without it the agent has only its built-in tools */
  mcp?: McpHub;
  /** keeps the commands the agent starts in the background; without it they can't be */
  tasks?: BackgroundTasks;
}

export async function runInChat({
  store,
  workspace,
  chat,
  prompt,
  attachments = [],
  skills = [],
  agentOptions = {},
  mcp,
  tasks,
}: RunInChatArgs): Promise<RunResult> {
  const rows = await store.loadMessages(chat.id);
  const conversation = Conversation.fromRows(rows);
  const planner = new Planner();
  planner.plan = chat.plan ?? null;
  planner.earlier = earlierPlansOf(chat, rows);

  // The workspace can override the planning step (Settings → Agent); without plan tools there
  // is nothing for it to make.
  const planning =
    workspace.disabledTools.includes('plans') || workspace.planning === 'off'
      ? 'off'
      : workspace.planning === 'auto'
        ? 'auto'
        : agentOptions.config?.planning;
  const agent = createAgent({
    ...agentOptions,
    config: { ...agentOptions.config, ...(planning ? { planning } : {}) },
    disabledTools: workspace.disabledTools,
    conversation,
    planner,
    memoryShown: chat.memoryShown ?? null,
    longTermMemory: store.memory(workspace),
    filesDir: workspace.path,
    instructions: workspace.instructions,
    voiceReplies: workspace.voiceMode,
    attachments: store.attachments(workspace),
    skills: store.skills(workspace),
    extraTools: mcp ? await mcpTools(store, workspace, mcp, agentOptions) : [],
    tasks: tasks?.forWorkspace(workspace.path, chat.id),
  });

  const fromSeq = rows.length;
  const startedAt = new Date();
  let result: RunResult | null = null;
  try {
    result = await agent.run(prompt, { attachments, skills });
    return result;
  } finally {
    // Save even if the run failed midway, so the chat keeps what happened.
    const messages = conversation.rows(fromSeq);
    if (messages.length) {
      await store.saveRun(chat.id, {
        fromSeq,
        messages,
        plan: planner.plan,
        earlierPlans: planner.earlier,
        memoryShown: agent.memoryShown,
        run: {
          prompt,
          status: result?.status ?? 'error',
          steps: result?.steps ?? 0,
          toolsUsed: result?.toolsUsed ?? [],
          usage: result?.usage ?? { inputTokens: 0, outputTokens: 0 },
          calls: result?.calls ?? [],
          startedAt,
        },
      });
    }
  }
}

/** The tools of the workspace's enabled, approved MCP servers. A problem with them never stops the run. */
async function mcpTools(
  store: Store,
  workspace: Workspace,
  hub: McpHub,
  { logger }: AgentRunOptions,
): Promise<AnyTool[]> {
  try {
    const [servers, state] = await Promise.all([
      store.mcpServers.list(),
      store.mcp(workspace).read(),
    ]);
    if (!state.isTrusted) {
      logger?.warn(
        `${state.file} changed outside the app, so its MCP servers stay off until you approve it in the MCP tab.`,
      );
    }
    const { tools } = await hub.tools(workspace.path, runnableMcpServers(servers, state));
    return tools;
  } catch (error) {
    logger?.warn(`MCP servers are off for this message: ${errorMessage(error)}`);
    return [];
  }
}

/**
 * A chat's earlier plans. Chats saved before earlier plans were kept still have every plan
 * tool call in their messages, so those are replayed to bring the old plans back.
 */
export function earlierPlansOf(
  chat: Pick<Chat, 'earlierPlans'>,
  rows: readonly ChatMessage[],
): Plan[] {
  return chat.earlierPlans.length ? [...chat.earlierPlans] : replayEarlierPlans(rows);
}

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Every plan but the last, as the plan tools left them (without times: they weren't saved). */
function replayEarlierPlans(rows: readonly ChatMessage[]): Plan[] {
  const planner = new Planner();
  for (const message of rows) {
    if (message.role !== 'assistant') continue;
    for (const call of message.tool_calls ?? []) {
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        continue;
      }
      if (!isRecord(args)) continue;
      try {
        if (call.function.name === 'create_plan') {
          planner.create(
            String(args.goal ?? ''),
            stringList(args.steps),
            String(args.done_when ?? ''),
          );
        } else if (call.function.name === 'update_plan') {
          planner.update(Number(args.step_number), String(args.status), String(args.note ?? ''));
        } else if (call.function.name === 'add_plan_steps') {
          planner.addSteps(stringList(args.steps));
        }
      } catch {
        // A call the agent got wrong then failed the same way: skip it here too.
      }
    }
  }
  return planner.earlier.map(({ createdAt: _replayedAt, ...plan }) => plan);
}

/** A chat title from the first message: its first line, shortened. */
export function titleFrom(prompt: string): string {
  const line = (
    String(prompt ?? '')
      .trim()
      .split('\n')[0] ?? ''
  ).replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 59).trimEnd()}…` : line || 'New chat';
}

/**
 * How many messages the summary at `index` newly took out of what the model sees: those from
 * the previous summary's start up to `upTo`.
 */
function summarizedCount(rows: readonly ChatMessage[], index: number, upTo: number): number {
  let from = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    const earlier = rows[i];
    if (earlier?.role === 'user' && earlier.summaryOf !== undefined) {
      from = earlier.summaryOf;
      break;
    }
  }
  let count = 0;
  for (let i = from; i < upTo; i += 1) {
    const row = rows[i];
    if (row && !(row.role === 'user' && row.summaryOf !== undefined)) count += 1;
  }
  return count;
}

/** A chat's messages as bubbles for the UI, with each run's steps and tokens. */
export function historyForUi(
  rows: readonly ChatMessage[],
  runs: Map<number, RunRecord> = new Map(),
): HistoryItem[] {
  const items: HistoryItem[] = [];
  const endTurn = (seq: number) => {
    const run = runs.get(seq);
    if (run) {
      items.push({
        role: 'meta',
        status: run.status,
        steps: run.steps,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cachedInputTokens: run.cachedInputTokens,
        cacheWriteTokens: run.cacheWriteTokens,
        calls: run.calls,
        finishedAt: run.finishedAt,
      });
    }
  };
  // Each tool call's saved result, by call id, so the chat shows it after a reload too.
  const results = new Map<string, string>();
  for (const m of rows) {
    if (m.role === 'tool') results.set(m.tool_call_id, m.content);
  }
  let turnStart: number | null = null;
  for (const [seq, m] of rows.entries()) {
    // A summary of the messages before it (context compaction): a note where it happened.
    if (m.role === 'user' && m.summaryOf !== undefined) {
      items.push({
        role: 'compaction',
        summarizedMessages: summarizedCount(rows, seq, m.summaryOf),
      });
      continue;
    }
    if (m.internal) continue; // the agent's own check messages
    if (m.role === 'user' && m.steeredAt !== undefined) {
      // Sent while the agent worked: part of the run under way, which goes on after it.
      items.push({
        role: 'user',
        text: m.display ?? m.content,
        attachments: [],
        skills: [],
        sentAt: m.steeredAt,
        steer: true,
      });
    } else if (m.role === 'user') {
      if (turnStart !== null) endTurn(turnStart);
      turnStart = seq;
      items.push({
        role: 'user',
        text: m.display ?? m.content,
        attachments: m.attachments ?? [],
        skills: m.skills ?? [],
        // The request this message started began when it was sent.
        sentAt: runs.get(seq)?.startedAt ?? null,
      });
    } else if (m.role === 'assistant') {
      if (m.content) items.push({ role: 'assistant', text: m.content });
      for (const call of m.tool_calls ?? []) {
        const saved = results.get(call.id);
        const { ok, preview } = toolResultPreview(saved ?? '');
        items.push({
          role: 'tool',
          name: call.function.name,
          args: call.function.arguments,
          ok: saved === undefined || ok,
          result: saved === undefined ? null : preview,
        });
      }
    }
  }
  if (turnStart !== null) endTurn(turnStart);
  return items;
}
