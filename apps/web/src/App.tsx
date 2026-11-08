import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChatRoute } from './features/chat/ChatRoute';
import { McpServerFormPage } from './features/mcp/McpServerFormPage';
import { McpServersPage } from './features/mcp/McpServersPage';
import { ModelFormPage } from './features/models/ModelFormPage';
import { ModelsPage } from './features/models/ModelsPage';
import { AgentSettingsPage } from './features/settings/AgentSettingsPage';
import { RootRedirect } from './features/workspaces/RootRedirect';
import { WorkspaceFormPage } from './features/workspaces/WorkspaceFormPage';
import { FormLayout } from './layout/FormLayout';
import { SettingsModal, useSettingsBackground } from './layout/SettingsModal';
import { ThemeProvider } from './lib/theme';
import { ToastProvider } from './lib/toast';

/** Models, Agent and MCP servers: full pages, or a popup over the chat (SettingsModal). */
const settingsRoutes = (
  <>
    <Route path="/settings/models" element={<ModelsPage />} />
    <Route path="/settings/agent" element={<AgentSettingsPage />} />
    <Route path="/settings/models/new" element={<ModelFormPage />} />
    <Route path="/settings/models/:modelId/edit" element={<ModelFormPage />} />
    <Route path="/settings/mcp" element={<McpServersPage />} />
    <Route path="/settings/mcp/new" element={<McpServerFormPage />} />
    <Route path="/settings/mcp/:serverName/edit" element={<McpServerFormPage />} />
  </>
);

/** New workspace and a workspace's settings: full pages, or a popup over the chat. */
const workspaceFormRoutes = (
  <>
    <Route path="/workspaces/new" element={<WorkspaceFormPage />} />
    <Route path="/workspaces/:workspaceId/settings" element={<WorkspaceFormPage />} />
  </>
);

function AppRoutes() {
  const location = useLocation();
  const navigate = useNavigate();
  // Settings opened from the chat screen: the chat stays underneath, settings in a popup.
  const background = useSettingsBackground(location);

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/" element={<RootRedirect />} />

        {/* Forms get their own pages, with the shared Topbar. */}
        <Route element={<FormLayout />}>
          {settingsRoutes}
          {workspaceFormRoutes}
        </Route>

        {/* The chat screen stays mounted while a new chat gets its id. */}
        <Route path="/workspaces/:workspaceId" element={<ChatRoute />}>
          <Route index element={null} />
          <Route path="chats/:chatId" element={null} />
        </Route>

        <Route path="/settings" element={<Navigate to="/settings/models" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {background && (
        <Routes>
          <Route element={<SettingsModal onClose={() => navigate(background)} />}>
            {settingsRoutes}
            {workspaceFormRoutes}
          </Route>
        </Routes>
      )}
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <ToastProvider>
          <AppRoutes />
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
