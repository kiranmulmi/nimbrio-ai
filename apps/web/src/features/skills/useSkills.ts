import { useCallback } from 'react';
import type { Skill } from '@app/shared';
import { useAsync, type AsyncResource } from '../../lib/useAsync';
import { fetchSkills } from './api';

/** The workspace's skills: shown in the Skills tab and offered in the composer. */
export function useSkills(workspaceId: string): AsyncResource<Skill[]> {
  const load = useCallback(() => fetchSkills(workspaceId), [workspaceId]);
  return useAsync(load);
}
