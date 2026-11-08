import fs from 'node:fs/promises';
import path from 'node:path';
import { refuseCommand, resolveInWorkspace } from '@app/agent';
import type { BackgroundTask, BackgroundTaskDetail, TaskStart } from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/**
 * The Tasks tab: commands running in the background in a workspace, started by the agent
 * (run_command with background: true) or by the user from the tab. The user can read their
 * output and stop them.
 */
export function createTasksService({ tasks }: AppContext, workspaces: WorkspacesService) {
  async function requireTask(workspaceId: string, taskId: string): Promise<BackgroundTaskDetail> {
    const workspace = await workspaces.require(workspaceId);
    const task = tasks.get(workspace.path, taskId);
    if (!task) throw new NotFoundError('That background task is gone.');
    return task;
  }

  return {
    /** The tasks still running (stopped ones are only kept for the agent to read). */
    async listRunning(workspaceId: string): Promise<BackgroundTask[]> {
      const workspace = await workspaces.require(workspaceId);
      return tasks.list(workspace.path).filter((task) => task.isRunning);
    },

    get: requireTask,

    /**
     * The user starts a command from the Tasks tab. It's their own action, like the terminal,
     * so there's no approval; it still runs only inside the workspace, without this app's
     * secrets, and never a catastrophic command (the agent's backstop).
     */
    async start(workspaceId: string, { command, cwd = '.' }: TaskStart): Promise<BackgroundTask> {
      const workspace = await workspaces.require(workspaceId);
      const refusal = refuseCommand(command);
      if (refusal) throw new ValidationError(`${refusal} It was not run.`);
      let target: string;
      try {
        target = await resolveInWorkspace(workspace.path, cwd);
      } catch {
        throw new ValidationError('Run it in a folder inside the workspace.');
      }
      if (!(await fs.stat(target).catch(() => null))?.isDirectory()) {
        throw new ValidationError(`"${cwd}" is not a folder in the workspace.`);
      }
      const root = await fs.realpath(workspace.path);
      const shown = path.relative(root, target).split(path.sep).join('/') || '.';
      try {
        return tasks.forWorkspace(workspace.path).start(command, target, shown);
      } catch (error) {
        // Too many running already: the message says which to stop.
        throw new ValidationError(error instanceof Error ? error.message : String(error));
      }
    },

    /** Stops the task and all it started; one that has already stopped is left as it is. */
    async stop(workspaceId: string, taskId: string): Promise<void> {
      const workspace = await workspaces.require(workspaceId);
      await requireTask(workspaceId, taskId);
      await tasks.stop(workspace.path, taskId);
    },
  };
}

export type TasksService = ReturnType<typeof createTasksService>;
