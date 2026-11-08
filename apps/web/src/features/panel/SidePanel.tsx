import type { ReactNode } from 'react';
import type { Memory, Skill, WorkspaceFiles } from '@app/shared';
import { IconButton } from '../../components/IconButton';
import {
  ExpandIcon,
  FolderIcon,
  GitDiffIcon,
  PanelIcon,
  PulseIcon,
  TerminalIcon,
} from '../../lib/icons';
import { TerminalPanel } from './terminal/TerminalPanel';
import type { AsyncResource } from '../../lib/useAsync';
import { FilesPanel } from './files/FilesPanel';
import { GitPanel } from './git/GitPanel';
import { useGitChangeCount } from './git/useGitChangeCount';
import { TasksPanel } from './tasks/TasksPanel';
import { useRunningTasks } from './tasks/useRunningTasks';
import { LowerPanel } from './LowerPanel';
import {
  PANEL_TAB_LABEL,
  visiblePanelTabs,
  type OptionalPanelTabs,
  type PanelTab,
} from './panelTabs';
import { PanelResizer } from './PanelResizer';
import { PanelTabButton } from './PanelTabButton';
import type { usePanelWidth } from './usePanelWidth';

const PANEL_TAB_ICON: Record<PanelTab, ReactNode> = {
  files: <FolderIcon size={14} />,
  terminal: <TerminalIcon size={14} />,
  git: <GitDiffIcon size={14} />,
  tasks: <PulseIcon size={14} />,
};

/** A small count beside a tab's label (running tasks, changed files). */
function TabCount({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="grid h-4 min-w-4 place-items-center rounded-full bg-success-bg px-1 text-[10.5px] font-bold tabular-nums text-success"
    >
      {children}
    </span>
  );
}

/**
 * Files, the terminal, the git diff or the background tasks on top, Memory, MCP servers and
 * Skills in a section below (LowerPanel). A resizable column on wide screens (collapsed from
 * the header's Panel button), a drawer on small ones.
 */
export function SidePanel({
  tab,
  onTab,
  workspaceId,
  memories,
  skills,
  files,
  width,
  isDrawerOpen,
  isCollapsed,
  isBusy,
  optionalTabs,
  onCloseDrawer,
  onHide,
  footer,
}: {
  /** one of the tabs shown (`visiblePanelTabs`) */
  tab: PanelTab;
  onTab: (tab: PanelTab) => void;
  workspaceId: string;
  memories: AsyncResource<Memory[]>;
  skills: AsyncResource<Skill[]>;
  files: AsyncResource<WorkspaceFiles>;
  width: ReturnType<typeof usePanelWidth>;
  isDrawerOpen: boolean;
  isCollapsed: boolean;
  /** the agent is working in this workspace */
  isBusy: boolean;
  /** which of the Terminal and Git diff tabs the workspace shows */
  optionalTabs: OptionalPanelTabs;
  onCloseDrawer: () => void;
  /** collapses the column (wide screens) or closes the drawer */
  onHide: () => void;
  /** a bar under the panel, e.g. the Preferences link */
  footer?: ReactNode;
}) {
  // Polled even while another tab is open, so the Tasks tab can say how many are running.
  const running = useRunningTasks(workspaceId, isBusy);
  const runningCount = running.tasks?.length ?? 0;
  const changed = useGitChangeCount(workspaceId, optionalTabs.git, isBusy);
  return (
    <>
      {isDrawerOpen && (
        <div
          aria-hidden
          onClick={onCloseDrawer}
          className="fixed inset-0 z-30 bg-overlay lg:hidden"
        />
      )}
      <aside
        id="side-panel"
        aria-label="Files, memory, MCP servers and terminal"
        // Wide screens: the column's width animates (ChatScreen) while the content keeps its
        // width and fades, so it slides in and out instead of squashing.
        className={`fixed inset-y-0 right-0 z-40 flex min-h-0 w-[min(440px,92vw)] flex-col border-l border-line bg-surface shadow-dialog transition-[transform,visibility,opacity] duration-300 lg:relative lg:inset-auto lg:z-10 lg:w-auto lg:translate-x-0 lg:overflow-hidden lg:border-line-2 lg:shadow-none ${
          isDrawerOpen ? 'translate-x-0' : 'translate-x-full max-lg:invisible'
        } ${isCollapsed ? 'lg:invisible lg:opacity-0' : ''}`}
      >
        <PanelResizer width={width.width} onResize={width.setWidth} onReset={width.reset} />
        <div className="flex h-12 shrink-0 items-stretch gap-2 border-b border-line bg-subtle pl-2 pr-2 lg:min-w-[var(--panel-w)]">
          <IconButton
            onClick={onHide}
            aria-controls="side-panel"
            aria-expanded
            title="Hide the panel"
            aria-label="Hide the panel"
            className="self-center"
          >
            <PanelIcon size={15} />
          </IconButton>
          <div
            role="tablist"
            aria-label="Panel"
            className="panel-tabs flex min-w-0 flex-1 items-stretch"
          >
            {visiblePanelTabs(optionalTabs).map((id) => (
              <PanelTabButton key={id} id={id} isActive={tab === id} onSelect={() => onTab(id)}>
                {PANEL_TAB_ICON[id]}
                {PANEL_TAB_LABEL[id]}
                {id === 'tasks' && runningCount > 0 && (
                  <TabCount title={`${runningCount} running`}>{runningCount}</TabCount>
                )}
                {id === 'git' && changed && changed.count > 0 && (
                  <TabCount
                    title={`${changed.count}${changed.isTruncated ? '+' : ''} ${
                      changed.count === 1 ? 'file' : 'files'
                    } changed`}
                  >
                    {changed.count}
                    {changed.isTruncated ? '+' : ''}
                  </TabCount>
                )}
              </PanelTabButton>
            ))}
          </div>
          <button
            type="button"
            onClick={width.toggleWide}
            aria-pressed={width.isWide}
            title={width.isWide ? 'Narrow panel' : 'Widen panel'}
            aria-label={width.isWide ? 'Narrow panel' : 'Widen panel'}
            className={`hidden h-8 w-8 shrink-0 place-items-center self-center rounded-lg transition-colors lg:grid ${
              width.isWide
                ? 'bg-accent-soft text-accent-2'
                : 'text-ink-3 hover:bg-surface-2 hover:text-ink'
            }`}
          >
            <ExpandIcon />
          </button>
        </div>
        <div
          id="panel-body"
          role="tabpanel"
          aria-labelledby={`panel-tab-${tab}`}
          data-panel-body
          className={`min-h-0 flex-1 lg:min-w-[var(--panel-w)] ${
            tab === 'terminal' ? 'overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          {tab === 'files' && <FilesPanel workspaceId={workspaceId} files={files} />}
          {tab === 'terminal' && <TerminalPanel workspaceId={workspaceId} />}
          {tab === 'git' && <GitPanel workspaceId={workspaceId} isBusy={isBusy} />}
          {tab === 'tasks' && <TasksPanel workspaceId={workspaceId} running={running} />}
        </div>
        <LowerPanel workspaceId={workspaceId} memories={memories} skills={skills} isBusy={isBusy} />
        {footer && (
          <footer className="flex h-8 shrink-0 items-center justify-end gap-1 border-t border-line-2 bg-subtle px-2 lg:min-w-[var(--panel-w)]">
            {footer}
          </footer>
        )}
      </aside>
    </>
  );
}
