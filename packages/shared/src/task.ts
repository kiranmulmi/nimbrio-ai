import { z } from 'zod';

/**
 * A command the agent started in the background (run_command with `background: true`): a dev
 * server, a watcher, anything meant to keep running after the agent's turn. The API process
 * holds them, so they stop when it does.
 */
export interface BackgroundTask {
  id: string;
  /** the bash command line */
  command: string;
  /** the folder it runs in, relative to the workspace folder ("." for the root) */
  cwd: string;
  /** the shell's process id; its process group holds everything the command started */
  pid: number | null;
  /** ISO time it started */
  startedAt: string;
  /** the chat whose run started it; null when the user started it in the Tasks tab */
  chatId: string | null;
  isRunning: boolean;
  /** once it has stopped: its exit code (null when a signal ended it) */
  exitCode: number | null;
}

/** GET /v1/workspaces/:id/tasks/:taskId: a task with its recent output. */
export interface BackgroundTaskDetail extends BackgroundTask {
  /** stdout and stderr together, colour codes removed: the start and the most recent part */
  output: string;
}

export const TASK_COMMAND_MAX_CHARS = 4_000;

/** POST /v1/workspaces/:id/tasks: the user starts a command in the background themselves. */
export const taskStartSchema = z.object({
  command: z.string().trim().min(1, 'Type a command.').max(TASK_COMMAND_MAX_CHARS),
  /** the folder to run it in, relative to the workspace folder; default its root */
  cwd: z.string().max(1_000).optional(),
});

export type TaskStart = z.infer<typeof taskStartSchema>;
