import type {
  CreatedEntry,
  FileContent,
  FileCreate,
  FileRename,
  FileSearchMode,
  FileSearchResult,
  FileWrite,
  WorkspaceFiles,
} from '@app/shared';
import { buildQuery, jsonBody, request } from '../../../lib/api';

const path = (workspaceId: string) => `/workspaces/${encodeURIComponent(workspaceId)}/files`;

export function fetchFiles(workspaceId: string): Promise<WorkspaceFiles> {
  return request<WorkspaceFiles>(path(workspaceId));
}

/** Throws an `ApiError` with status 413 when the file is too big to preview. */
export function fetchFileContent(workspaceId: string, filePath: string): Promise<FileContent> {
  return request<FileContent>(`${path(workspaceId)}/content${buildQuery({ path: filePath })}`);
}

export function searchFiles(
  workspaceId: string,
  query: string,
  mode: FileSearchMode,
): Promise<FileSearchResult> {
  return request<FileSearchResult>(`${path(workspaceId)}/search${buildQuery({ q: query, mode })}`);
}

/** Throws an `ApiError` with status 409 when the file changed on disk since `baseVersion`. */
export function saveFile(workspaceId: string, input: FileWrite): Promise<FileContent> {
  return request<FileContent>(`${path(workspaceId)}/content`, jsonBody('PUT', input));
}

export function createEntry(workspaceId: string, input: FileCreate): Promise<CreatedEntry> {
  return request<CreatedEntry>(path(workspaceId), jsonBody('POST', input));
}

export function renameEntry(workspaceId: string, input: FileRename): Promise<CreatedEntry> {
  return request<CreatedEntry>(path(workspaceId), jsonBody('PATCH', input));
}

/** Permanent: the caller confirms first. */
export function deleteEntry(workspaceId: string, entryPath: string): Promise<void> {
  return request<void>(`${path(workspaceId)}${buildQuery({ path: entryPath })}`, {
    method: 'DELETE',
  });
}
