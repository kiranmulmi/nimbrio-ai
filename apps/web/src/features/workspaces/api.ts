import type {
  FolderCheck,
  FolderListing,
  FolderPick,
  InstructionsDraft,
  InstructionsDraftRequest,
  Workspace,
  WorkspaceDeletion,
  WorkspaceInput,
  WorkspaceUpdate,
} from '@app/shared';
import { buildQuery, jsonBody, request } from '../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}`;

export function fetchWorkspaces(): Promise<Workspace[]> {
  return request<Workspace[]>('/workspaces');
}

export function fetchWorkspace(workspaceId: string): Promise<Workspace> {
  return request<Workspace>(path(workspaceId));
}

export function createWorkspace(input: WorkspaceInput): Promise<Workspace> {
  return request<Workspace>('/workspaces', jsonBody('POST', input));
}

export function updateWorkspace(workspaceId: string, input: WorkspaceUpdate): Promise<Workspace> {
  return request<Workspace>(path(workspaceId), jsonBody('PATCH', input));
}

export function deleteWorkspace(workspaceId: string): Promise<WorkspaceDeletion> {
  return request<WorkspaceDeletion>(path(workspaceId), { method: 'DELETE' });
}

/** One level of the folder browser; no path starts at the home folder. */
export function fetchFolders(folderPath?: string): Promise<FolderListing> {
  return request<FolderListing>(`/folders${buildQuery({ path: folderPath })}`);
}

/** Why the folder can't be this workspace's (or a new one's), e.g. another uses it; or null. */
export async function checkWorkspaceFolder(
  folderPath: string,
  workspaceId?: string,
): Promise<string | null> {
  const { problem } = await request<FolderCheck>(
    `/folders/check${buildQuery({ path: folderPath, workspaceId })}`,
  );
  return problem;
}

/**
 * Opens this computer's own folder window (the API runs here) and waits for the choice.
 * `isSupported: false` means there is none to open, so the in-app browser is used instead.
 */
export function pickFolderWithSystemDialog(startAt?: string): Promise<FolderPick> {
  return request<FolderPick>('/folders/pick', jsonBody('POST', { startAt }));
}

/** Instructions written by the default model from a request and the workspace (nothing saved). */
export async function writeInstructions(input: InstructionsDraftRequest): Promise<string> {
  const { text } = await request<InstructionsDraft>(
    '/prompts/instructions',
    jsonBody('POST', input),
  );
  return text;
}
