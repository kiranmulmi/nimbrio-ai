import { createContext, useContext, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { GearIcon, ServerIcon, SparkIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';

const TABS = [
  { to: '/settings/models', label: 'Models', icon: <SparkIcon size={13} /> },
  { to: '/settings/mcp', label: 'MCP servers', icon: <ServerIcon size={13} /> },
  { to: '/settings/agent', label: 'Agent settings', icon: <GearIcon size={13} /> },
] as const;

/** Set inside the Preferences popup, whose side tabs replace each page's own tabs. */
const SideTabsContext = createContext(false);

/** Switches between the app-wide settings pages, keeping where they were opened from. */
export function SettingsTabs() {
  const location = useLocation();
  const from = fromPath(location.state);
  if (useContext(SideTabsContext)) return null;

  return (
    <nav aria-label="Settings" className="mb-5 flex gap-1 border-b border-line">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end
          state={from ? { from } : undefined}
          className={({ isActive }) =>
            `-mb-px border-b-2 px-3 pb-2.5 pt-1 text-[13px] font-medium transition-colors ${
              isActive
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-3 hover:border-line-strong hover:text-ink'
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * The Preferences popup's layout: the settings pages as vertical tabs on the left (a row
 * above on phones), the open page beside them. A page's forms (a new model, an MCP server)
 * keep their tab selected.
 */
export function SettingsSideTabs({ children }: { children: ReactNode }) {
  const location = useLocation();
  const from = fromPath(location.state);

  return (
    <div className="flex min-h-full flex-col gap-4 md:flex-row md:gap-6">
      <nav
        aria-label="Settings"
        className="-mx-1 flex shrink-0 gap-1 overflow-x-auto border-b border-line pb-2 md:mx-0 md:w-48 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:pb-0 md:pr-4"
      >
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            state={from ? { from } : undefined}
            className={({ isActive }) =>
              `flex h-9 shrink-0 items-center gap-2.5 rounded-xl px-3 text-[13px] font-medium transition-colors ${
                isActive ? 'bg-accent-soft text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg ${
                    isActive ? 'bg-accent text-on-accent' : 'bg-accent-soft text-accent-2'
                  }`}
                >
                  {tab.icon}
                </span>
                <span className="whitespace-nowrap">{tab.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="min-w-0 flex-1">
        <SideTabsContext.Provider value>{children}</SideTabsContext.Provider>
      </div>
    </div>
  );
}
