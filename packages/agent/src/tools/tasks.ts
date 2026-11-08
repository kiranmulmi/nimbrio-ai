import type { BackgroundTask } from '@app/shared';
import { defineTool, type ToolContext } from './define.js';

function tasksOf(ctx: ToolContext) {
  if (!ctx.tasks) throw new Error("Background tasks aren't available here.");
  return ctx.tasks;
}

function describe(task: BackgroundTask): string {
  const where = task.cwd === '.' ? '' : ` (in ${task.cwd}/)`;
  const state = task.isRunning
    ? `running since ${task.startedAt}`
    : task.exitCode === null
      ? 'stopped (ended by a signal)'
      : `stopped (exit code ${task.exitCode})`;
  return `${task.id}: $ ${task.command}${where} · ${state}`;
}

interface TaskOutputInput {
  task_id?: string;
}

export const taskOutput = defineTool<TaskOutputInput>({
  name: 'task_output',
  description:
    "Check on background tasks started with run_command background: true. With a task_id, get its state and recent output (stdout and stderr together), e.g. to see whether a dev server is up or why it crashed; without one, list the workspace's tasks.",
  properties: {
    task_id: { type: 'string', description: 'The task id run_command gave. Leave out to list.' },
  },
  optional: ['task_id'],
  async run({ task_id: id }, ctx) {
    const tasks = tasksOf(ctx);
    if (!id) {
      const all = tasks.list();
      return all.length ? all.map(describe).join('\n') : 'No background tasks in this workspace.';
    }
    const task = tasks.get(id.trim());
    if (!task)
      throw new Error(`There is no background task "${id}". Leave out task_id to list them.`);
    return `${describe(task)}\n\n${task.output.trimEnd() || '(no output yet)'}`;
  },
});

interface StopTaskInput {
  task_id: string;
}

export const stopTask = defineTool<StopTaskInput>({
  name: 'stop_task',
  description:
    'Stop a background task (and everything it started), e.g. a dev server that is no longer needed or must restart after a config change.',
  properties: {
    task_id: { type: 'string', description: 'The task id run_command gave.' },
  },
  needsApproval: true,
  async run({ task_id: id }, ctx) {
    const tasks = tasksOf(ctx);
    const task = tasks.get(id.trim());
    if (!task) throw new Error(`There is no background task "${id}".`);
    if (!task.isRunning) return `Task ${task.id} had already stopped.`;
    await tasks.stop(task.id);
    return `Stopped task ${task.id} ($ ${task.command}).`;
  },
});
