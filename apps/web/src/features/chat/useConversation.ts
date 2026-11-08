import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { Attachment, ChatDetail, ChatSummary, ReasoningEffort } from '@app/shared';
import { errorMessage, isNotFound } from '../../lib/api';
import { parseStreamEvent, readEventData } from '../../lib/sse';
import {
  decideApproval,
  fetchChat,
  setRunAutoApprove,
  startRun,
  steerRun,
  stopRun as requestStop,
} from './api';
import { conversationReducer, initialConversation } from './conversation';

type Options = {
  workspaceId: string;
  /** The chat in the URL, or null for a new chat. */
  chatId: string | null;
  /** The stream's first event: the chat the message went to. `isNew` when it was just made. */
  onChat: (chat: ChatSummary, isNew: boolean) => void;
  /** The agent decided to plan, so the plan panel is worth showing. */
  /** A run ended (finished, failed or was cut off): lists elsewhere may have changed. */
  onRunEnd: () => void;
  onLoaded: (detail: ChatDetail) => void;
  onLoadError: (cause: unknown) => void;
  /** Messages sent during a run came back to the message box unread; `reason` says why. */
  onMessagesReturned: (reason: string) => void;
};

/** A message sent while the agent works, shown until the agent reads it. */
export type QueuedMessage = {
  key: number;
  /** Null until the server accepts it. */
  id: string | null;
  text: string;
};

/** Text going back into the message box; a new `key` each time. */
export type ReturnedDraft = { text: string; key: number };

/** Which model a message goes to; left out, the server uses its default model. */
export type SendOptions = {
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  /** Uploaded already (useDraftAttachments); sent as their ids. */
  attachments?: Attachment[];
  /** Run tools without asking (the composer's Auto-approve). */
  autoApprove?: boolean;
  /** Skills picked for this message, by name. */
  skills?: string[];
};

/**
 * The reply as it streams, for reading it aloud (voice mode): `text` pieces, and `break` when
 * something else happened (a tool call, an approval), so a sentence cut there is said as is.
 */
export type ReplyStreamEvent = { type: 'text'; text: string } | { type: 'break' };
type ReplyListener = (event: ReplyStreamEvent) => void;

type Run = {
  controller: AbortController;
  workspaceId: string;
  /** Null until the stream says which chat a new conversation went to. */
  chatId: string | null;
};

/**
 * The open chat: loads its history when the URL changes, sends messages through
 * `POST /v1/runs` and folds the event stream into the conversation as it arrives.
 * Leaving the chat while a run streams closes the connection; the server then denies
 * any approval still waiting, as it does when the tab closes.
 */
export function useConversation(options: Options) {
  const { workspaceId, chatId } = options;
  const [state, dispatch] = useReducer(conversationReducer, initialConversation);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRunningElsewhere, setIsRunningElsewhere] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const runRef = useRef<Run | null>(null);
  // Messages sent during this tab's run that the agent hasn't read yet.
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const queuedRef = useRef<QueuedMessage[]>([]);
  // The ids of those the agent read, in case that happens before their POST answers.
  const readIds = useRef(new Set<string>());
  const queueKey = useRef(0);
  const [returned, setReturned] = useState<ReturnedDraft | null>(null);
  const callbacks = useRef(options);
  const replyListeners = useRef(new Set<ReplyListener>());
  const tellListeners = (event: ReplyStreamEvent) => {
    for (const listener of replyListeners.current) listener(event);
  };

  useEffect(() => {
    callbacks.current = options;
  });

  const setQueue = useCallback((next: QueuedMessage[]) => {
    queuedRef.current = next;
    setQueued(next);
  }, []);

  /** Puts unread messages back in the message box, so nothing typed is lost. */
  const giveBack = useCallback((texts: string[], reason: string) => {
    if (!texts.length) return;
    setReturned((current) => ({ text: texts.join('\n\n'), key: (current?.key ?? 0) + 1 }));
    callbacks.current.onMessagesReturned(reason);
  }, []);

  const stopRun = useCallback(() => {
    const run = runRef.current;
    runRef.current = null;
    if (run) {
      run.controller.abort();
      setIsBusy(false);
    }
  }, []);

  // Leaving the screen ends the stream.
  useEffect(() => stopRun, [stopRun]);

  useEffect(() => {
    const run = runRef.current;
    // The live run owns this view, including the moment a new chat gets its id.
    if (run && run.workspaceId === workspaceId && run.chatId === chatId) return;
    stopRun();
    setIsRunningElsewhere(false);
    // Already sent: the run reads them whether or not this chat stays open.
    setQueue([]);

    if (!chatId) {
      dispatch({ type: 'reset' });
      setIsLoading(false);
      return;
    }

    let isCurrent = true;
    setIsLoading(true);
    fetchChat(chatId)
      .then((detail) => {
        if (!isCurrent) return;
        dispatch({ type: 'load', detail });
        setIsRunningElsewhere(detail.chat.isRunning);
        callbacks.current.onLoaded(detail);
      })
      .catch((cause: unknown) => {
        if (isCurrent) callbacks.current.onLoadError(cause);
      })
      .finally(() => {
        if (isCurrent) setIsLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, chatId, reloadToken, stopRun, setQueue]);

  const send = useCallback(
    async (
      text: string,
      { modelId, reasoningEffort, attachments = [], autoApprove, skills = [] }: SendOptions = {},
    ) => {
      const message = text.trim();
      if ((!message && !attachments.length) || runRef.current) return;

      const run: Run = { controller: new AbortController(), workspaceId, chatId };
      runRef.current = run;
      const isCurrent = () => runRef.current === run;
      readIds.current = new Set();
      setIsBusy(true);
      setIsRunningElsewhere(false);
      dispatch({ type: 'send', text: message, attachments, skills, at: Date.now() });

      // Text deltas are merged and applied at most once per frame.
      let pending = '';
      let frame = 0;
      const flush = () => {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        if (pending && isCurrent()) {
          dispatch({ type: 'event', event: { type: 'text_delta', text: pending }, at: Date.now() });
        }
        pending = '';
      };

      try {
        const body = await startRun(
          {
            workspaceId,
            chatId: chatId ?? undefined,
            message,
            attachmentIds: attachments.length ? attachments.map((a) => a.id) : undefined,
            modelId,
            reasoningEffort,
            autoApprove: autoApprove || undefined,
            skills: skills.length ? skills : undefined,
          },
          run.controller.signal,
        );
        for await (const data of readEventData(body)) {
          if (!isCurrent()) break;
          const event = parseStreamEvent(data);
          if (!event) continue;
          if (event.type === 'text_delta') {
            tellListeners({ type: 'text', text: event.text });
            pending += event.text;
            if (!frame) frame = requestAnimationFrame(flush);
            continue;
          }
          flush();
          tellListeners({ type: 'break' });
          if (event.type === 'chat') {
            const isNew = run.chatId === null;
            run.chatId = event.chat.id;
            callbacks.current.onChat(event.chat, isNew);
            continue;
          }
          if (event.type === 'steer') {
            readIds.current.add(event.id);
            setQueue(queuedRef.current.filter((message) => message.id !== event.id));
          }
          dispatch({ type: 'event', event, at: Date.now() });
        }
        flush();
      } catch (cause) {
        flush();
        if (isCurrent()) dispatch({ type: 'fail', message: errorMessage(cause) });
      } finally {
        if (frame) cancelAnimationFrame(frame);
        if (isCurrent()) {
          runRef.current = null;
          dispatch({ type: 'finish', at: Date.now() });
          setIsBusy(false);
          const unread = queuedRef.current.map((message) => message.text);
          setQueue([]);
          giveBack(
            unread,
            unread.length === 1
              ? "The agent finished before it read your last message, so it's back in the message box."
              : "The agent finished before it read your last messages, so they're back in the message box.",
          );
        }
        callbacks.current.onRunEnd();
      }
    },
    [workspaceId, chatId, setQueue, giveBack],
  );

  /**
   * Sends a message to this tab's run in progress: it waits (shown in `queued`) until the agent
   * reads it before its next step. One the run can't take goes back to the message box.
   */
  const steer = useCallback(
    async (text: string) => {
      const message = text.trim();
      const run = runRef.current;
      if (!message || !run) return;
      if (!run.chatId) {
        giveBack([message], 'The chat is still starting. Send it again in a moment.');
        return;
      }
      queueKey.current += 1;
      const key = queueKey.current;
      setQueue([...queuedRef.current, { key, id: null, text: message }]);
      const isWaiting = () => queuedRef.current.some((item) => item.key === key);
      try {
        const { id } = await steerRun(run.chatId, message);
        if (!isWaiting()) return; // the run ended meanwhile and gave it back
        setQueue(
          readIds.current.has(id)
            ? queuedRef.current.filter((item) => item.key !== key)
            : queuedRef.current.map((item) => (item.key === key ? { ...item, id } : item)),
        );
      } catch (cause) {
        if (!isWaiting()) return;
        setQueue(queuedRef.current.filter((item) => item.key !== key));
        giveBack(
          [message],
          isNotFound(cause)
            ? 'The agent had already finished, so your message is back in the message box.'
            : errorMessage(cause),
        );
      }
    },
    [setQueue, giveBack],
  );

  const decide = useCallback(async (approvalId: string, allow: boolean) => {
    dispatch({ type: 'approval_sending', approvalId });
    try {
      const { allowed } = await decideApproval(approvalId, allow);
      dispatch({ type: 'approval_decided', approvalId, allowed });
    } catch (cause) {
      dispatch({ type: 'approval_failed', approvalId, message: errorMessage(cause) });
    }
  }, []);

  /**
   * Applies an Auto-approve change to the chat's run in progress (this tab's, or one running
   * elsewhere), from its next approval on. Nothing to do when none is running.
   */
  const changeAutoApprove = useCallback(
    async (autoApprove: boolean) => {
      const target = runRef.current?.chatId ?? (isRunningElsewhere ? chatId : null);
      if (!target) return;
      try {
        await setRunAutoApprove(target, autoApprove);
      } catch (cause) {
        if (!isNotFound(cause)) throw cause; // it finished meanwhile: the next message uses it
      }
    },
    [chatId, isRunningElsewhere],
  );

  /** Clears the view for a new chat (when the URL is already the new-chat one). */
  const reset = useCallback(() => {
    if (!runRef.current) dispatch({ type: 'reset' });
  }, []);

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  /** Follows the reply text as it streams in (voice mode reads it aloud). Returns the unsubscribe. */
  const subscribeReply = useCallback((listener: ReplyListener) => {
    const listeners = replyListeners.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  /**
   * Asks the server to stop the run (this tab's, or one running elsewhere). The stream keeps
   * going until the agent has stopped and saved what it did, then ends as `stopped`.
   */
  const [isStopping, setIsStopping] = useState(false);
  const stop = useCallback(async () => {
    const target = runRef.current?.chatId ?? chatId;
    if (!target) return;
    setIsStopping(true);
    dispatch({ type: 'stopping' });
    try {
      await requestStop(target);
    } catch {
      // Already finished: nothing to stop.
    } finally {
      setIsStopping(false);
      // Stopped from here while it ran in another tab: show what it saved once it's done.
      if (!runRef.current) window.setTimeout(reload, 1200);
    }
  }, [chatId, reload]);

  return {
    state,
    isBusy,
    isLoading,
    isRunningElsewhere,
    isStopping,
    send,
    steer,
    queued,
    returned,
    stop,
    decide,
    changeAutoApprove,
    reset,
    reload,
    subscribeReply,
  };
}
