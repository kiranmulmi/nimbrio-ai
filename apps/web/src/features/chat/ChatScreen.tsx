import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ChatSummary } from '@app/shared';
import { AppNav } from '../../layout/AppNav';
import { errorMessage, isNotFound } from '../../lib/api';
import { useToast } from '../../lib/toast';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useStoredState } from '../../lib/useStoredState';
import { useFiles } from '../panel/files/useFiles';
import { useMemories } from '../panel/memory/useMemories';
import { SkillDialogProvider } from '../skills/SkillDialogProvider';
import { useSkills } from '../skills/useSkills';
import { parsePanelTab, visiblePanelTabs, type PanelTab } from '../panel/panelTabs';
import { SidePanel } from '../panel/SidePanel';
import { PreferencesLink } from './PreferencesLink';
import { usePanelWidth } from '../panel/usePanelWidth';
import { useWorkspace } from '../workspaces/useWorkspace';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import { onWorkspaceSaved } from '../workspaces/workspaceEvents';
import { rememberLastWorkspace } from '../workspaces/lastWorkspace';
import { improvePrompt } from './api';
import { ChatHeader } from './ChatHeader';
import { ChatSidebar } from './ChatSidebar';
import { ChatView } from './ChatView';
import { AutoApproveToggle } from './AutoApproveToggle';
import { ModelControls } from './ModelControls';
import { useAppInfo } from './useAppInfo';
import { useChats } from './useChats';
import { useConversation } from './useConversation';
import { useModelChoice } from './useModelChoice';
import { useSidebarWidth } from './useSidebarWidth';
import { APP_NAME } from '../../lib/brand';

const parseFlag = (stored: string | null) => stored === 'true';

/**
 * The chat screen for one workspace: sidebar (workspaces and chats), the open chat,
 * and the side panel (plan, memory, files). `chatId` is null for a new chat.
 */
export function ChatScreen({
  workspaceId,
  chatId,
}: {
  workspaceId: string;
  chatId: string | null;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const workspacePath = `/workspaces/${workspaceId}`;

  const info = useAppInfo();
  const workspace = useWorkspace(workspaceId);
  const workspaces = useWorkspaces();
  const chats = useChats(workspaceId);
  const memories = useMemories(workspaceId);
  const skills = useSkills(workspaceId);
  const files = useFiles(workspaceId);
  const { models, choice, chooseModel, chooseEffort } = useModelChoice();
  // Like the model, a choice for the messages from here on (shown in warning colours while on).
  const [autoApprove, setAutoApprove] = useStoredState('agent.autoApprove', parseFlag);

  const isWide = useMediaQuery('(min-width: 1024px)');
  const panelWidth = usePanelWidth();
  const sidebarWidth = useSidebarWidth();
  const [tab, setTab] = useStoredState<PanelTab>('agent.panelTab', parsePanelTab);
  const [isPanelCollapsed, setIsPanelCollapsed] = useStoredState('agent.panelCollapsed', parseFlag);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useStoredState(
    'agent.sidebarCollapsed',
    parseFlag,
  );
  const [isPanelDrawerOpen, setIsPanelDrawerOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const { upsert: upsertChat, remove: removeChat, reload: reloadChats } = chats;
  const { reload: reloadMemories } = memories;
  const { reload: reloadFiles } = files;
  const { reload: reloadWorkspaces } = workspaces;
  const { reload: reloadWorkspace } = workspace;

  // A workspace saved in the popup over this screen: show its new name, folder, instructions.
  useEffect(
    () =>
      onWorkspaceSaved(() => {
        reloadWorkspace();
        reloadWorkspaces();
      }),
    [reloadWorkspace, reloadWorkspaces],
  );

  const conversation = useConversation({
    workspaceId,
    chatId,
    onChat: (chat, isNew) => {
      upsertChat({ ...chat, isRunning: true });
      if (isNew) navigate(`${workspacePath}/chats/${chat.id}`, { replace: true });
    },
    onRunEnd: () => {
      reloadChats();
      reloadMemories();
      reloadFiles();
      reloadWorkspaces();
    },
    onLoaded: (detail) => {
      // A chat link from another workspace: show it where it belongs.
      if (detail.chat.workspaceId !== workspaceId) {
        navigate(`/workspaces/${detail.chat.workspaceId}/chats/${detail.chat.id}`, {
          replace: true,
        });
      }
    },
    onMessagesReturned: (reason) => toast(reason, 'warning'),
    onLoadError: (cause) => {
      if (isNotFound(cause)) {
        toast('That chat no longer exists.', 'warning');
        navigate(workspacePath, { replace: true });
      } else {
        toast(errorMessage(cause, "Couldn't open the chat."), 'error');
      }
    },
  });
  const { isBusy } = conversation;

  // Opened fine: this is the workspace to come back to on the next launch.
  const loadedWorkspaceId = workspace.data?.id;
  useEffect(() => {
    if (loadedWorkspaceId) rememberLastWorkspace(loadedWorkspaceId);
  }, [loadedWorkspaceId]);

  useEffect(() => {
    if (!isNotFound(workspace.error)) return;
    toast('That workspace no longer exists.', 'warning');
    navigate('/', { replace: true });
  }, [workspace.error, navigate, toast]);

  // On a small screen the drawers cover the chat, so opening another chat closes them.
  useEffect(() => {
    setIsSidebarOpen(false);
    setIsPanelDrawerOpen(false);
  }, [chatId]);

  const workspaceName = workspace.data?.name;
  const chatTitle = chats.data?.find((chat) => chat.id === chatId)?.title;
  useEffect(() => {
    document.title = workspaceName
      ? chatTitle
        ? `${chatTitle} · ${workspaceName}`
        : `${workspaceName} · ${APP_NAME}`
      : APP_NAME;
  }, [chatTitle, workspaceName]);

  // Terminal and Git diff each show only when the workspace turns them on; a remembered one
  // that's hidden here shows Files instead (and comes back where it's on).
  const hasTerminalTab = workspace.data?.hasTerminalTab ?? false;
  const hasGitTab = workspace.data?.hasGitTab ?? false;
  const optionalTabs = useMemo(
    () => ({ terminal: hasTerminalTab, git: hasGitTab }),
    [hasTerminalTab, hasGitTab],
  );
  const shownTab = visiblePanelTabs(optionalTabs).includes(tab) ? tab : 'files';

  const selectTab = (next: PanelTab) => {
    setTab(next);
    if (next === 'files') reloadFiles();
  };

  const isPanelShown = isWide ? !isPanelCollapsed : isPanelDrawerOpen;
  const togglePanel = () => {
    if (isWide) setIsPanelCollapsed(!isPanelCollapsed);
    else setIsPanelDrawerOpen((open) => !open);
  };

  const { reset } = conversation;
  const startNewChat = () => {
    if (isBusy) return;
    setIsSidebarOpen(false);
    if (chatId) navigate(workspacePath);
    else reset();
  };

  const onRenamed = useCallback((chat: ChatSummary) => upsertChat(chat), [upsertChat]);
  const onDeleted = useCallback(
    (deletedId: string) => {
      removeChat(deletedId);
      reloadWorkspaces();
      if (deletedId === chatId) navigate(workspacePath, { replace: true });
    },
    [removeChat, reloadWorkspaces, chatId, navigate, workspacePath],
  );

  // Collapsed columns shrink to 0 (rather than being removed), so the change in width can
  // be animated (grid-template-columns transitions when the track count stays the same).
  const panelStyle = {
    '--panel-w': `${panelWidth.width}px`,
    '--panel-col': isPanelCollapsed ? '0px' : `${panelWidth.width}px`,
    '--sidebar-w': `${sidebarWidth.width}px`,
    '--sidebar-col': isSidebarCollapsed ? '0px' : `${sidebarWidth.width}px`,
  } as CSSProperties;
  const columns =
    'lg:grid-cols-[minmax(0,1fr)_var(--panel-col)] xl:grid-cols-[var(--sidebar-col)_minmax(0,1fr)_var(--panel-col)]';
  const workspaceList = workspaces.data ?? [];

  return (
    <SkillDialogProvider workspaceId={workspaceId} skills={skills}>
      <div className="flex h-full flex-col bg-bg">
        <AppNav
          workspace={workspace.data}
          workspaces={workspaceList}
          onOpenWorkspaces={reloadWorkspaces}
          info={info.data}
          infoError={info.error}
          isBusy={isBusy}
          hasSidebar
          chatsToggle={{
            isOpen: isSidebarOpen,
            onToggle: () => setIsSidebarOpen((open) => !open),
          }}
        />
        <div
          // One row; the footer (Preferences) sits at the bottom of the side panel.
          className={`panel-grid grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] lg:transition-[grid-template-columns] lg:duration-300 lg:ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none ${columns}`}
          style={panelStyle}
        >
          <ChatSidebar
            isOpen={isSidebarOpen}
            isCollapsed={isSidebarCollapsed}
            onCollapse={() => setIsSidebarCollapsed(true)}
            onClose={() => setIsSidebarOpen(false)}
            width={sidebarWidth}
            workspaceId={workspaceId}
            workspace={workspace.data}
            workspaces={workspaceList}
            onOpenWorkspaces={reloadWorkspaces}
            info={info.data}
            infoError={info.error}
            chats={chats.data}
            chatsError={chats.error}
            activeChatId={chatId}
            isBusy={isBusy}
            onNewChat={startNewChat}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
          />
          <div className="flex min-h-0 min-w-0 flex-col bg-surface">
            <ChatHeader
              title={chatId ? (chatTitle ?? 'Chat') : 'New chat'}
              isBusy={isBusy}
              isPanelShown={isPanelShown}
              onTogglePanel={togglePanel}
              onShowSidebar={isSidebarCollapsed ? () => setIsSidebarCollapsed(false) : undefined}
            />
            <ChatView
              workspaceId={workspaceId}
              chatKey={chatId ?? 'new'}
              state={conversation.state}
              workspace={workspace.data}
              showWorkspaceName={
                workspaceList.length > 1 ||
                (workspaceName !== undefined && workspaceName !== 'Default')
              }
              isBusy={isBusy}
              isLoading={conversation.isLoading}
              isRunningElsewhere={conversation.isRunningElsewhere}
              hasModel={choice.model !== null}
              modelControls={
                <div className="flex min-w-0 items-center gap-0.5">
                  <ModelControls
                    models={models.data}
                    choice={choice}
                    disabled={isBusy}
                    onChooseModel={chooseModel}
                    onChooseEffort={chooseEffort}
                  />
                  {/* Only when the agent asks first (Settings → Agent: approvals "ask"). */}
                  {info.data?.approval === 'ask' && (
                    <AutoApproveToggle
                      isOn={autoApprove}
                      onChange={(isOn) => {
                        setAutoApprove(isOn);
                        conversation
                          .changeAutoApprove(isOn)
                          .catch((cause: unknown) =>
                            toast(errorMessage(cause, "Couldn't change Auto-approve."), 'error'),
                          );
                      }}
                    />
                  )}
                </div>
              }
              skills={skills.data}
              onSend={(text, attachments, picked) =>
                void conversation.send(text, {
                  attachments,
                  skills: picked,
                  autoApprove: info.data?.approval === 'ask' && autoApprove,
                  modelId: choice.model?.id,
                  reasoningEffort: (choice.model?.supportsReasoning && choice.effort) || undefined,
                })
              }
              onSteer={(text) => void conversation.steer(text)}
              queued={conversation.queued}
              restoreDraft={conversation.returned}
              onImprove={(text) =>
                improvePrompt({
                  text,
                  workspaceId,
                  modelId: choice.model?.id,
                  reasoningEffort: (choice.model?.supportsReasoning && choice.effort) || undefined,
                })
              }
              onStop={() => void conversation.stop()}
              isStopping={conversation.isStopping}
              onDecide={(approvalId, allow) => void conversation.decide(approvalId, allow)}
              onReload={() => {
                conversation.reload();
                reloadChats();
              }}
              isVoiceMode={workspace.data?.voiceMode ?? false}
              subscribeReply={conversation.subscribeReply}
            />
          </div>
          <SidePanel
            tab={shownTab}
            onTab={selectTab}
            optionalTabs={optionalTabs}
            workspaceId={workspaceId}
            memories={memories}
            skills={skills}
            files={files}
            width={panelWidth}
            isDrawerOpen={isPanelDrawerOpen}
            isCollapsed={isPanelCollapsed}
            isBusy={isBusy}
            onCloseDrawer={() => setIsPanelDrawerOpen(false)}
            onHide={togglePanel}
            footer={<PreferencesLink approval={info.data?.approval ?? null} />}
          />
        </div>
      </div>
    </SkillDialogProvider>
  );
}
