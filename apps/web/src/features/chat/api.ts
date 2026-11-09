import type {
  AppInfo,
  Attachment,
  ChatDetail,
  ChatSummary,
  ImprovePromptRequest,
  ImprovedPrompt,
  RunChange,
  RunRequest,
  SteerAccepted,
} from '@app/shared';
import { jsonBody, request, requestBlob, requestStream } from '../../lib/api';

const chatPath = (chatId: string) => `/chats/${encodeURIComponent(chatId)}`;

export function fetchAppInfo(): Promise<AppInfo> {
  return request<AppInfo>('/info');
}

/** Newest first, each with its `isRunning` flag. */
export function fetchChats(workspaceId: string): Promise<ChatSummary[]> {
  return request<ChatSummary[]>(`/workspaces/${encodeURIComponent(workspaceId)}/chats`);
}

export function fetchChat(chatId: string): Promise<ChatDetail> {
  return request<ChatDetail>(chatPath(chatId));
}

export function renameChat(chatId: string, title: string): Promise<ChatSummary> {
  return request<ChatSummary>(chatPath(chatId), jsonBody('PATCH', { title }));
}

export function deleteChat(chatId: string): Promise<void> {
  return request<void>(chatPath(chatId), { method: 'DELETE' });
}

/** Starts the agent on one message; the body is the run's event stream. */
export function startRun(
  input: RunRequest,
  signal: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  return requestStream('/runs', input, signal);
}

export function decideApproval(approvalId: string, allow: boolean): Promise<{ allowed: boolean }> {
  return request<{ allowed: boolean }>(
    `/approvals/${encodeURIComponent(approvalId)}`,
    jsonBody('POST', { allow }),
  );
}

/** The file's bytes as base64, without the data URL prefix. */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`Couldn't read ${file.name}.`));
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

/** Keeps a file for the agent in the workspace's private uploads; send its id with the message. */
export async function uploadAttachment(workspaceId: string, file: File): Promise<Attachment> {
  const data = await readBase64(file);
  return request<Attachment>(
    `/workspaces/${encodeURIComponent(workspaceId)}/attachments`,
    jsonBody('POST', { name: file.name, type: file.type, data }),
  );
}

/** An attached file's contents, to show or save in the browser. */
export function fetchAttachment(workspaceId: string, attachmentId: string): Promise<Blob> {
  return requestBlob(
    `/workspaces/${encodeURIComponent(workspaceId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
  );
}

/** The draft rewritten by the model, to replace what's in the message box. */
export async function improvePrompt(input: ImprovePromptRequest): Promise<string> {
  const { text } = await request<ImprovedPrompt>('/prompts/improve', jsonBody('POST', input));
  return text;
}

/** Stops the chat's run, from this tab or another; its stream then ends as stopped. */
/** Turns Auto-approve on or off for the chat's run in progress (404 when none is running). */
export function setRunAutoApprove(chatId: string, autoApprove: boolean): Promise<RunChange> {
  return request<RunChange>(`${chatPath(chatId)}/run`, jsonBody('PATCH', { autoApprove }));
}

/** A message for the chat's run in progress: the agent reads it before its next step. */
export function steerRun(chatId: string, message: string): Promise<SteerAccepted> {
  return request<SteerAccepted>(`${chatPath(chatId)}/run/messages`, jsonBody('POST', { message }));
}

export function stopRun(chatId: string): Promise<void> {
  return request<void>(`${chatPath(chatId)}/stop`, jsonBody('POST', {}));
}
