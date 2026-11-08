import type { Memory, MemoryRemoval } from '@app/shared';
import { request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/memories`;

export function fetchMemories(workspaceId: string): Promise<Memory[]> {
  return request<Memory[]>(path(workspaceId));
}

export function deleteMemory(workspaceId: string, memoryId: string): Promise<MemoryRemoval> {
  return request<MemoryRemoval>(`${path(workspaceId)}/${encodeURIComponent(memoryId)}`, {
    method: 'DELETE',
  });
}

export function clearMemories(workspaceId: string): Promise<MemoryRemoval> {
  return request<MemoryRemoval>(path(workspaceId), { method: 'DELETE' });
}
