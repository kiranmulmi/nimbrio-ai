// Commands the agent leaves running on purpose (run_command with background: true): dev
// servers, watchers, anything that should outlive the agent's turn. The app holds one
// BackgroundTasks for its whole life; each run gets a view of one workspace's tasks
// (`forWorkspace`), so a chat can only see and stop the tasks of its own workspace.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { BackgroundTask, BackgroundTaskDetail } from '@app/shared';
import { commandEnv } from './guardrails.js';
import { BoundedOutput, isProcessGroup, shellFor, signalGroup } from './tools/shell.js';

/** Running tasks one workspace may have at once. */
const MAX_RUNNING = 10;
/** Stopped tasks kept per workspace, so their last output can still be read. */
const KEEP_STOPPED = 10;
/** After SIGTERM: how long a task gets to stop before SIGKILL. */
const STOP_GRACE_MS = 3_000;

interface Entry {
  task: BackgroundTask;
  workspace: string;
  output: BoundedOutput;
  child: ChildProcess;
  /** resolves once the task's process and its output have closed */
  closed: Promise<void>;
}

/** One workspace's tasks, as a run's tools see them. */
export interface WorkspaceTasks {
  /** Starts `command` in `cwd` (absolute, already checked); `shownCwd` is it relative to the workspace. */
  start(command: string, cwd: string, shownCwd: string): BackgroundTask;
  /** Running tasks first (oldest first), then recently stopped ones (newest first). */
  list(): BackgroundTask[];
  get(id: string): BackgroundTaskDetail | null;
  /** Waits until the task stops or `ms` pass (or `signal` aborts); true if it stopped. */
  waitForStop(id: string, ms: number, signal?: AbortSignal): Promise<boolean>;
  /** Stops the task and all it started; false when there's no such running task. */
  stop(id: string): Promise<boolean>;
}

export class BackgroundTasks {
  private readonly entries = new Map<string, Entry>();

  /** The tasks of one workspace folder; tasks it starts are tagged with `chatId`. */
  forWorkspace(workspace: string, chatId: string | null = null): WorkspaceTasks {
    return {
      start: (command, cwd, shownCwd) => this.start(workspace, chatId, command, cwd, shownCwd),
      list: () => this.list(workspace),
      get: (id) => this.get(workspace, id),
      waitForStop: (id, ms, signal) => this.waitForStop(workspace, id, ms, signal),
      stop: (id) => this.stop(workspace, id),
    };
  }

  list(workspace: string): BackgroundTask[] {
    const tasks = [...this.entries.values()]
      .filter((entry) => entry.workspace === workspace)
      .map((entry) => ({ ...entry.task }));
    const running = tasks.filter((task) => task.isRunning);
    const stopped = tasks.filter((task) => !task.isRunning).reverse();
    return [...running, ...stopped];
  }

  get(workspace: string, id: string): BackgroundTaskDetail | null {
    const entry = this.entryFor(workspace, id);
    return entry ? { ...entry.task, output: entry.output.text() } : null;
  }

  async stop(workspace: string, id: string): Promise<boolean> {
    const entry = this.entryFor(workspace, id);
    if (!entry?.task.isRunning) return false;
    await this.end(entry);
    return true;
  }

  async waitForStop(
    workspace: string,
    id: string,
    ms: number,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const entry = this.entryFor(workspace, id);
    if (!entry) return true;
    if (!entry.task.isRunning) return true;
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    const waited = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
      onAbort = resolve;
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    await Promise.race([entry.closed, waited]);
    clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    return !entry.task.isRunning;
  }

  /** Stops every task (the app is shutting down). */
  async close(): Promise<void> {
    await Promise.all(
      [...this.entries.values()].filter((e) => e.task.isRunning).map((e) => this.end(e)),
    );
  }

  /** Stops one workspace's tasks and forgets them (the workspace is deleted or moved). */
  async closeWorkspace(workspace: string): Promise<void> {
    const entries = [...this.entries.values()].filter((e) => e.workspace === workspace);
    await Promise.all(entries.filter((e) => e.task.isRunning).map((e) => this.end(e)));
    for (const entry of entries) this.entries.delete(entry.task.id);
  }

  private entryFor(workspace: string, id: string): Entry | null {
    const entry = this.entries.get(id);
    return entry && entry.workspace === workspace ? entry : null;
  }

  private start(
    workspace: string,
    chatId: string | null,
    command: string,
    cwd: string,
    shownCwd: string,
  ): BackgroundTask {
    const running = this.list(workspace).filter((task) => task.isRunning).length;
    if (running >= MAX_RUNNING) {
      throw new Error(
        `This workspace already has ${running} background tasks running. Stop one (stop_task) first.`,
      );
    }
    const { file, args } = shellFor(command);
    const child = spawn(file, args, {
      cwd,
      env: commandEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: isProcessGroup,
      windowsHide: true,
    });
    const output = new BoundedOutput();
    child.stdout?.on('data', (chunk: Buffer) => output.add(chunk.toString('utf8')));
    child.stderr?.on('data', (chunk: Buffer) => output.add(chunk.toString('utf8')));

    const task: BackgroundTask = {
      id: randomUUID().slice(0, 8),
      command,
      cwd: shownCwd,
      pid: child.pid ?? null,
      startedAt: new Date().toISOString(),
      chatId,
      isRunning: true,
      exitCode: null,
    };
    const closed = new Promise<void>((resolve) => {
      child.on('error', (error) => {
        output.add(`\nCouldn't start the shell: ${error.message}\n`);
        task.isRunning = false;
        resolve();
      });
      // The shell is done: stop anything it left behind, so a stopped task holds nothing.
      let leftovers: NodeJS.Timeout | undefined;
      child.on('exit', (code) => {
        task.exitCode = code;
        signalGroup(child, 'SIGTERM');
        leftovers = setTimeout(() => signalGroup(child, 'SIGKILL'), STOP_GRACE_MS);
      });
      child.on('close', (code) => {
        clearTimeout(leftovers);
        task.exitCode ??= code;
        task.isRunning = false;
        this.forgetOldStopped(workspace);
        resolve();
      });
    });
    this.entries.set(task.id, { task, workspace, output, child, closed });
    return { ...task };
  }

  private async end(entry: Entry): Promise<void> {
    signalGroup(entry.child, 'SIGTERM');
    const force = setTimeout(() => signalGroup(entry.child, 'SIGKILL'), STOP_GRACE_MS);
    await entry.closed;
    clearTimeout(force);
  }

  private forgetOldStopped(workspace: string): void {
    const stopped = [...this.entries.values()].filter(
      (entry) => entry.workspace === workspace && !entry.task.isRunning,
    );
    for (const entry of stopped.slice(0, Math.max(0, stopped.length - KEEP_STOPPED))) {
      this.entries.delete(entry.task.id);
    }
  }
}
