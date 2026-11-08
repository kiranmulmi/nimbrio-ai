/**
 * The panel's top tabs: the workspace's files, its terminal, what changed in git, and the
 * background tasks the agent left running.
 */
export const PANEL_TABS = ['files', 'terminal', 'git', 'tasks'] as const;

export type PanelTab = (typeof PANEL_TABS)[number];

/** The optional top tabs a workspace turns on (`hasTerminalTab`, `hasGitTab`); off by default. */
export interface OptionalPanelTabs {
  terminal: boolean;
  git: boolean;
}

/** The top tabs this workspace shows: Files and Tasks always, Terminal and Git diff when on. */
export function visiblePanelTabs(optional: OptionalPanelTabs): readonly PanelTab[] {
  return PANEL_TABS.filter((tab) =>
    tab === 'terminal' ? optional.terminal : tab === 'git' ? optional.git : true,
  );
}

/** The tabs of the section below them: what the agent remembers, the MCP servers, the skills. */
export const LOWER_PANEL_TABS = ['skills', 'memory', 'mcp'] as const;

export type LowerPanelTab = (typeof LOWER_PANEL_TABS)[number];

export const PANEL_TAB_LABEL: Record<PanelTab | LowerPanelTab, string> = {
  files: 'Files',
  terminal: 'Terminal',
  git: 'Git diff',
  tasks: 'Tasks',
  memory: 'Memory',
  mcp: 'MCP',
  skills: 'Skills',
};

export function parsePanelTab(stored: string | null): PanelTab {
  return PANEL_TABS.find((tab) => tab === stored) ?? 'files';
}

export function parseLowerPanelTab(stored: string | null): LowerPanelTab {
  return LOWER_PANEL_TABS.find((tab) => tab === stored) ?? 'skills';
}
