import { checkInput, createModelCaller, suggestChatTitle } from '@app/agent';
import { runInChat, titleFrom } from '@app/db';
import type { RunRequest, SteerAccepted, StreamEvent } from '@app/shared';
import type { AppContext } from '../../context.js';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { AttachmentsService } from '../attachments/attachments.service.js';
import type { ChatsService } from '../chats/chats.service.js';
import type { ModelsService } from '../models/models.service.js';
import type { SkillsService } from '../skills/skills.service.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';
import { MAX_WAITING_MESSAGES } from './run-registry.js';

/** The app writes a chat's title from its first few messages, then leaves it be. */
const TITLE_MESSAGES = 3;

export interface RunStream {
  send: (event: StreamEvent) => void;
  /** Registers a callback for when the client disconnects. */
  onClose: (callback: () => void) => void;
}

export function createRunsService(
  context: AppContext,
  workspaces: WorkspacesService,
  chats: ChatsService,
  models: ModelsService,
  attachments: AttachmentsService,
  skills: SkillsService,
) {
  const { store, agentConfig, settings, agentLogger, runs, mcp, tasks } = context;

  return {
    /**
     * Validates the request and claims the chat. Throws before anything is streamed,
     * so the client gets a normal JSON error. Returns the function that runs the agent.
     */
    async prepare({
      workspaceId,
      chatId,
      message,
      attachmentIds = [],
      modelId,
      reasoningEffort,
      autoApprove = false,
      skills: skillNames = [],
    }: RunRequest) {
      const workspace = await workspaces.require(workspaceId);
      const existing = chatId ? await chats.require(chatId, workspace.id) : null;
      // Read once per run, so a settings change applies from the next message on.
      const config = settings.configFor(agentConfig);
      const files = await attachments.requireAll(workspace, attachmentIds);
      const picked = await skills.requireAll(workspace, skillNames);
      // A message of files only has no text to check.
      if (message.trim() || !files.length) {
        const inputCheck = checkInput(message, config);
        if (!inputCheck.ok) throw new ValidationError(inputCheck.reason);
      }
      const { settings: model } = await models.forRun(modelId, reasoningEffort);
      const title = titleFrom(message.trim() ? message : (files[0]?.name ?? ''));
      const chat = existing ?? (await store.createChat(workspace.id, title));
      if (runs.isRunning(chat.id)) {
        throw new ConflictError('The agent is still working on the previous message in this chat.');
      }
      // What the user has asked so far, this message included, for the chat's title.
      const askedBefore = existing
        ? (await store.loadMessages(chat.id))
            .filter((row) => row.role === 'user' && !row.internal)
            .map((row) => row.display ?? row.content)
        : [];
      const asked = [...askedBefore, message.trim() || files.map((f) => f.name).join(', ')];
      // Also chats from before titles were written: theirs is still their first message.
      const hasFirstLineTitle = chat.title === titleFrom(asked[0] ?? '');
      const isTitleDue =
        !chat.isTitleCustom && (asked.length <= TITLE_MESSAGES || hasFirstLineTitle);
      const signal = runs.start(chat.id, workspace.id, autoApprove);

      return async function stream({ send, onClose }: RunStream): Promise<void> {
        const approver = runs.createApprover(chat.id, config.approval, send);
        onClose(approver.denyAll);
        // Stopping also answers any approval the agent is waiting on.
        signal.addEventListener('abort', approver.denyAll, { once: true });
        send({ type: 'chat', chat: chats.summarize(chat) });
        // Written alongside the run, so it's ready by the time the answer is.
        const title = isTitleDue
          ? suggestChatTitle(createModelCaller(model), asked).catch((error: unknown) => {
              agentLogger.warn(
                `Couldn't write a title for the chat: ${error instanceof Error ? error.message : String(error)}`,
              );
              return null;
            })
          : Promise.resolve(null);
        try {
          const result = await runInChat({
            store,
            workspace,
            chat,
            prompt: message,
            attachments: files,
            skills: picked,
            mcp,
            tasks,
            agentOptions: {
              config,
              model,
              approve: approver.approve,
              signal,
              steering: runs.inbox(chat.id),
              onEvent: send,
              logger: agentLogger,
            },
          });
          const suggested = await title;
          const titled = suggested ? await store.setAutoTitle(chat.id, suggested) : null;
          if (titled) send({ type: 'chat', chat: chats.summarize(titled) });
          send({ type: 'done', result });
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error);
          agentLogger.error(`Run failed: ${text}`);
          send({ type: 'error', message: text });
        } finally {
          runs.finish(chat.id);
        }
      };
    },

    /**
     * A message for the chat's run in progress: the agent reads it before its next step, and
     * the run's stream sends a `steer` event when it does.
     */
    steer(chatId: string, message: string): SteerAccepted {
      const inputCheck = checkInput(message, settings.configFor(agentConfig));
      if (!inputCheck.ok) throw new ValidationError(inputCheck.reason);
      const queued = runs.steer(chatId, message.trim());
      if (queued === null) throw new NotFoundError('That chat has no run in progress.');
      if (queued === 'full') {
        throw new ConflictError(
          `${MAX_WAITING_MESSAGES} messages are already waiting for the agent. Wait until it reads them.`,
        );
      }
      return { id: queued.id };
    },
  };
}

export type RunsService = ReturnType<typeof createRunsService>;
