import {
  mcpTransportOf,
  TOOL_GROUPS,
  TOOL_GROUP_LABELS,
  WORKSPACE_PLANNING,
  type McpServerEntry,
  type ToolGroup,
  type WorkspacePlanning,
} from '@app/shared';
import { Switch } from '../../components/Switch';

const TRANSPORT_LABEL = { stdio: 'Local', http: 'HTTP', sse: 'SSE' } as const;

const LIST = 'mt-2 divide-y divide-line-2 overflow-hidden rounded-xl border border-line bg-surface';

const PLANNING_LABEL: Record<WorkspacePlanning, string> = {
  default: 'Agent settings',
  auto: 'On',
  off: 'Off',
};

/** The workspace's planning step: follow Settings → Agent, or on or off here. */
export function PlanningChoice({
  id,
  value,
  onChange,
  isPlansOff,
}: {
  id: string;
  value: WorkspacePlanning;
  onChange: (value: WorkspacePlanning) => void;
  /** without plan tools there is no planning step */
  isPlansOff: boolean;
}) {
  const current = isPlansOff ? 'off' : value;
  return (
    <div>
      <div
        id={id}
        role="radiogroup"
        aria-label="Planning step"
        className="mt-2 inline-flex rounded-xl border border-line bg-surface p-0.5"
      >
        {WORKSPACE_PLANNING.map((option) => {
          const isOn = current === option;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isOn}
              disabled={isPlansOff}
              onClick={() => onChange(option)}
              className={`h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed ${
                isOn
                  ? 'bg-accent-soft text-accent-2'
                  : 'text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-50 disabled:hover:bg-transparent'
              }`}
            >
              {PLANNING_LABEL[option]}
            </button>
          );
        })}
      </div>
      {isPlansOff && (
        <p className="mt-1.5 text-[12.5px] text-ink-3">Off while the Plans tools are off.</p>
      )}
    </div>
  );
}

/** How you chat in this workspace: typing, or talking (voice mode). */
export function ChatModeChoice({
  id,
  isVoice,
  onChange,
}: {
  id: string;
  isVoice: boolean;
  onChange: (isVoice: boolean) => void;
}) {
  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Chat mode"
      className="mt-2 inline-flex rounded-xl border border-line bg-surface p-0.5"
    >
      {[
        { value: false, label: 'Text' },
        { value: true, label: 'Voice' },
      ].map((option) => {
        const isOn = isVoice === option.value;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={isOn}
            onClick={() => onChange(option.value)}
            className={`h-8 rounded-lg px-3.5 text-[13px] font-medium transition-colors ${
              isOn ? 'bg-accent-soft text-accent-2' : 'text-ink-2 hover:bg-subtle hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** One switch per tool group; on unless turned off. */
export function ToolGroupSwitches({
  disabled,
  onChange,
}: {
  disabled: readonly ToolGroup[];
  onChange: (disabled: ToolGroup[]) => void;
}) {
  return (
    <ul className={LIST}>
      {TOOL_GROUPS.map((group) => {
        const isOn = !disabled.includes(group);
        const { label, detail } = TOOL_GROUP_LABELS[group];
        return (
          <li key={group} className="flex items-center gap-3 px-3.5 py-2.5">
            <div className="min-w-0 flex-1">
              <div className={`text-[13.5px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}>
                {label}
              </div>
              <div className="text-[12.5px] leading-snug text-ink-3">{detail}</div>
            </div>
            <Switch
              isOn={isOn}
              label={`${label} tools`}
              title={isOn ? `Turn off the ${label} tools` : `Turn on the ${label} tools`}
              onChange={(next) =>
                onChange(
                  next
                    ? disabled.filter((item) => item !== group)
                    : TOOL_GROUPS.filter((item) => item === group || disabled.includes(item)),
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}

/** One switch per optional side panel tab, in the same list style as the tool switches. */
export function PanelTabSwitches({
  tabs,
}: {
  tabs: ReadonlyArray<{
    label: string;
    detail: string;
    isOn: boolean;
    onChange: (isOn: boolean) => void;
  }>;
}) {
  return (
    <ul className={LIST}>
      {tabs.map(({ label, detail, isOn, onChange }) => (
        <li key={label} className="flex items-center gap-3 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <div className={`text-[13.5px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}>
              {label}
            </div>
            <div className="text-[12.5px] leading-snug text-ink-3">{detail}</div>
          </div>
          <Switch
            isOn={isOn}
            label={`${label} tab`}
            title={isOn ? `Hide the ${label} tab` : `Show the ${label} tab`}
            onChange={onChange}
          />
        </li>
      ))}
    </ul>
  );
}

/** One switch per MCP server set up in the app; off here until turned on. */
export function McpServerSwitches({
  servers,
  enabled,
  onChange,
}: {
  servers: readonly McpServerEntry[];
  enabled: readonly string[];
  onChange: (enabled: string[]) => void;
}) {
  return (
    <ul className={LIST}>
      {servers.map(({ name, server }) => {
        const isOn = enabled.includes(name);
        const launch =
          mcpTransportOf(server) === 'stdio'
            ? [server.command ?? '', ...(server.args ?? [])].join(' ')
            : (server.url ?? '');
        return (
          <li key={name} className="flex items-center gap-3 px-3.5 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span
                  className={`truncate font-mono text-[13px] font-medium ${isOn ? 'text-ink' : 'text-ink-3'}`}
                >
                  {name}
                </span>
                <span className="shrink-0 text-[10.5px] font-medium uppercase tracking-[0.12em] text-ink-3">
                  {TRANSPORT_LABEL[mcpTransportOf(server)]}
                </span>
              </div>
              <div className="truncate font-mono text-[11.5px] text-ink-3" title={launch}>
                {launch}
              </div>
            </div>
            <Switch
              isOn={isOn}
              label={`MCP server ${name}`}
              title={isOn ? `Turn ${name} off here` : `Turn ${name} on here`}
              onChange={(next) =>
                onChange(
                  servers
                    .map((entry) => entry.name)
                    .filter((item) => (item === name ? next : enabled.includes(item))),
                )
              }
            />
          </li>
        );
      })}
    </ul>
  );
}
