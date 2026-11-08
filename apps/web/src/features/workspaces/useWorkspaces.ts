import type { Workspace } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchWorkspaces } from './api';

export function useWorkspaces(): AsyncResource<Workspace[]> {
  return useAsync(fetchWorkspaces);
}
