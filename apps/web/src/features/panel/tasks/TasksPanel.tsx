import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TASK_COMMAND_MAX_CHARS, type BackgroundTask } from '@app/shared';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { Spinner } from '../../../components/Spinner';
import { errorMessage } from '../../../lib/api';
import { formatDuration, plural } from '../../../lib/format';
import { ChevronRightIcon, PlayIcon, PulseIcon, RefreshIcon, StopIcon } from '../../../lib/icons';
import { useNow } from '../../../lib/useNow';
import { usePageVisible } from '../../../lib/usePageVisible';
import { useToast } from '../../../lib/toast';
import { PanelMessage } from '../PanelMessage';
import { fetchTask, startTask, stopTask } from './api';
import type { useRunningTasks } from './useRunningTasks';

/** How often an open task's output is fetched again. */
const OUTPUT_POLL_MS = 1_500;

/**
 * The Tasks tab: commands running in the background, such as a dev server or a watcher,
 * started by the agent (run_command with background: true) or typed into the box at the top.
 * Only running ones are listed; one that stops (or is stopped here) drops off. Click one to
 * follow its output.
 */
export function TasksPanel({
  workspaceId,
  running,
}: {
  workspaceId: string;
  running: ReturnType<typeof useRunningTasks>;
}) {
  const { tasks, error, refresh } = running;
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [isRefreshing, setIsRefreshing] = useState(false);

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const reload = () => {
    setIsRefreshing(true);
    void refresh().finally(() => setIsRefreshing(false));
  };

  return (
    <div className="min-h-full">
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-2 border-b border-line-2 bg-surface py-1.5 pl-4 pr-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-[12px] text-ink-3">
          <PulseIcon size={13} className="shrink-0 text-accent" />
          {tasks
            ? tasks.length
              ? `${plural(tasks.length, 'task')} running`
              : 'Nothing running'
            : ''}
        </span>
        <IconButton onClick={reload} disabled={isRefreshing} aria-label="Refresh" title="Refresh">
          {isRefreshing ? <Spinner size={12} /> : <RefreshIcon />}
        </IconButton>
      </div>

      <CommandBox
        workspaceId={workspaceId}
        onStarted={(task) => {
          setOpen((current) => new Set(current).add(task.id));
          void refresh();
        }}
      />

      {tasks && error && (
        <p role="alert" className="border-b border-line-2 px-4 py-2 text-[12.5px] text-danger">
          {error} The list below may be out of date.
        </p>
      )}

      {!tasks ? (
        <div className="p-4">
          <PanelMessage isLoading={!error} error={error} onRetry={reload} />
        </div>
      ) : tasks.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] leading-relaxed text-ink-3">
          No background tasks running. Start one above, or ask the agent to start something that
          keeps running, like a dev server or a watcher. It shows here until it stops.
        </p>
      ) : (
        tasks.map((task) => (
          <TaskRow
            key={task.id}
            workspaceId={workspaceId}
            task={task}
            isOpen={open.has(task.id)}
            onToggle={() => toggle(task.id)}
            onStopped={() => void refresh()}
          />
        ))
      )}
    </div>
  );
}

/** Type a command and press Enter: it starts in the background in the workspace folder. */
function CommandBox({
  workspaceId,
  onStarted,
}: {
  workspaceId: string;
  onStarted: (task: BackgroundTask) => void;
}) {
  const toast = useToast();
  const [command, setCommand] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    const text = command.trim();
    if (!text || isStarting) return;
    setIsStarting(true);
    setError(null);
    try {
      const task = await startTask(workspaceId, { command: text });
      setCommand('');
      toast(`Started ${task.command}`);
      onStarted(task);
    } catch (cause) {
      setError(errorMessage(cause, "Couldn't start the command."));
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
      className="border-b border-line-2 px-3 py-2"
    >
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 transition-colors focus-within:border-accent">
        <span aria-hidden className="font-mono text-[12.5px] font-bold text-accent">
          $
        </span>
        <input
          value={command}
          onChange={(event) => {
            setCommand(event.target.value);
            setError(null);
          }}
          maxLength={TASK_COMMAND_MAX_CHARS}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Command to run in the background"
          placeholder="Run in the background, e.g. npm run dev"
          className="h-8 min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:font-sans placeholder:text-ink-3"
        />
        <Button size="sm" variant="plain" type="submit" disabled={!command.trim() || isStarting}>
          {isStarting ? <Spinner size={12} /> : <PlayIcon size={11} />} Run
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 text-[12px] text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function TaskRow({
  workspaceId,
  task,
  isOpen,
  onToggle,
  onStopped,
}: {
  workspaceId: string;
  task: BackgroundTask;
  isOpen: boolean;
  onToggle: () => void;
  onStopped: () => void;
}) {
  const toast = useToast();
  const now = useNow(true, 1_000);
  const [isStopping, setIsStopping] = useState(false);
  const elapsed = (now - Date.parse(task.startedAt)) / 1000;

  const stop = async () => {
    setIsStopping(true);
    try {
      await stopTask(workspaceId, task.id);
      toast(`Stopped ${task.command}`);
      onStopped();
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't stop the task."), 'error');
      setIsStopping(false);
    }
  };

  return (
    <div className="border-b border-line-2 last:border-b-0">
      <div
        className={`group flex h-10 items-center gap-2 pl-3 pr-2 transition-colors hover:bg-subtle ${
          isOpen ? 'bg-subtle' : ''
        }`}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          title={task.cwd === '.' ? task.command : `${task.command}  (in ${task.cwd}/)`}
          className="flex h-full min-w-0 flex-1 items-center gap-2 text-left text-[12.5px]"
        >
          <ChevronRightIcon
            size={10}
            className={`shrink-0 text-ink-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
          />
          <span aria-hidden className="live-dot bg-success" />
          <span className="sr-only">Running:</span>
          <span className="min-w-0 flex-1 truncate font-mono">
            {task.cwd !== '.' && <span className="text-ink-3">{task.cwd}/ </span>}
            <span className="font-semibold text-ink">{task.command}</span>
          </span>
          <span
            title={`Started ${new Date(task.startedAt).toLocaleString()}${task.pid ? ` · pid ${task.pid}` : ''}`}
            className="shrink-0 font-mono text-[11.5px] tabular-nums text-ink-3"
          >
            {formatDuration(elapsed)}
          </span>
        </button>
        <button
          type="button"
          onClick={() => void stop()}
          disabled={isStopping}
          title="Stop this task and everything it started"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-ink-2 transition-colors hover:bg-danger-bg hover:text-danger disabled:opacity-50"
        >
          {isStopping ? <Spinner size={11} /> : <StopIcon size={10} />} Stop
        </button>
      </div>
      {isOpen && <TaskOutput workspaceId={workspaceId} taskId={task.id} />}
    </div>
  );
}

/** A task's recent output, fetched again every moment while it's open. */
function TaskOutput({ workspaceId, taskId }: { workspaceId: string; taskId: string }) {
  const [output, setOutput] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLPreElement>(null);
  // Follows the end of the output unless the reader scrolled up.
  const isPinned = useRef(true);
  const isPageVisible = usePageVisible();

  useEffect(() => {
    if (!isPageVisible) return;
    let isCurrent = true;
    const load = () =>
      fetchTask(workspaceId, taskId)
        .then((task) => {
          if (!isCurrent) return;
          setOutput(task.output);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (isCurrent) setError(errorMessage(cause, "Couldn't load the output."));
        });
    void load();
    const timer = window.setInterval(() => void load(), OUTPUT_POLL_MS);
    return () => {
      isCurrent = false;
      window.clearInterval(timer);
    };
  }, [workspaceId, taskId, isPageVisible]);

  useLayoutEffect(() => {
    const node = box.current;
    if (node && isPinned.current) node.scrollTop = node.scrollHeight;
  }, [output]);

  if (output === null) {
    return (
      <div className="flex items-center gap-2 border-t border-line-2 px-3 py-2.5 text-[12.5px] text-ink-3">
        {error ? (
          <span className="text-danger">{error}</span>
        ) : (
          <>
            <Spinner size={12} /> Loading the output…
          </>
        )}
      </div>
    );
  }
  return (
    <pre
      ref={box}
      onScroll={(event) => {
        const node = event.currentTarget;
        isPinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
      }}
      className="max-h-80 overflow-auto border-t border-line-2 bg-subtle px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-2 [overflow-wrap:anywhere] whitespace-pre-wrap"
    >
      {output.trimEnd() || <span className="text-ink-3">No output yet.</span>}
    </pre>
  );
}
