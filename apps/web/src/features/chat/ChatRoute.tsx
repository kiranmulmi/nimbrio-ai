import { Navigate, useMatch, useParams } from 'react-router-dom';
import { ChatScreen } from './ChatScreen';

/**
 * The layout route for `/workspaces/:workspaceId` (a new chat) and its child
 * `chats/:chatId`. It stays mounted while the child changes, so a new chat that gets
 * its id mid-stream keeps the stream. Another workspace remounts the screen fresh.
 */
export function ChatRoute() {
  const { workspaceId } = useParams();
  const chatMatch = useMatch('/workspaces/:workspaceId/chats/:chatId');
  const chatId = chatMatch?.params.chatId ?? null;
  if (!workspaceId) return <Navigate to="/" replace />;
  return <ChatScreen key={workspaceId} workspaceId={workspaceId} chatId={chatId} />;
}
