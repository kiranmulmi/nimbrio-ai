import type { BackgroundTask, BackgroundTaskDetail, TaskStart } from '@app/shared';
import { jsonBody, request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/tasks`;

/** The workspace's background tasks that are still running. */
export function fetchRunningTasks(workspaceId: string): Promise<BackgroundTask[]> {
  return request<BackgroundTask[]>(path(workspaceId));
}

/** Starts a command in the background in the workspace (the user's own, no approval). */
export function startTask(workspaceId: string, input: TaskStart): Promise<BackgroundTask> {
  return request<BackgroundTask>(path(workspaceId), jsonBody('POST', input));
}

export function fetchTask(workspaceId: string, taskId: string): Promise<BackgroundTaskDetail> {
  return request<BackgroundTaskDetail>(`${path(workspaceId)}/${encodeURIComponent(taskId)}`);
}

export function stopTask(workspaceId: string, taskId: string): Promise<void> {
  return request<void>(`${path(workspaceId)}/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  });
}
