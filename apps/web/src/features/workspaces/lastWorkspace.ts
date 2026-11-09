import { readPref, writePref } from '../../lib/storage';

/** The workspace opened last, so `/` reopens it on the next launch (a UI preference). */
const LAST_WORKSPACE_KEY = 'agent.lastWorkspaceId';

export function readLastWorkspaceId(): string | null {
  return readPref(LAST_WORKSPACE_KEY);
}

export function rememberLastWorkspace(workspaceId: string): void {
  writePref(LAST_WORKSPACE_KEY, workspaceId);
}
