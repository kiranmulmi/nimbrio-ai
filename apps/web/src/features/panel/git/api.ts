import type { GitChanges, GitFileDiff } from '@app/shared';
import { buildQuery, request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/git`;

export function fetchGitChanges(workspaceId: string): Promise<GitChanges> {
  return request<GitChanges>(path(workspaceId));
}

export function fetchGitDiff(workspaceId: string, filePath: string): Promise<GitFileDiff> {
  return request<GitFileDiff>(`${path(workspaceId)}/diff${buildQuery({ path: filePath })}`);
}
