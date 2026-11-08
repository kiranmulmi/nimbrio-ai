import { CheckIcon, ShieldIcon } from '../../lib/icons';

/**
 * The composer's Auto-approve switch: on, the agent runs tools (file changes, commands, MCP
 * tools) without asking, from the next approval of a run in progress and for later messages.
 * Shown on as a filled accent pill with a check, so it stands out in the toolbar and isn't left on
 * unnoticed, without clashing with the theme.
 */
export function AutoApproveToggle({
  isOn,
  onChange,
}: {
  isOn: boolean;
  onChange: (isOn: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={isOn}
      onClick={(event) => {
        // The composer focuses its text box on click; this is a control of its own.
        event.stopPropagation();
        onChange(!isOn);
      }}
      title={
        isOn
          ? 'Auto-approve is on: the agent changes files and runs commands without asking. Click to ask again.'
          : 'Let the agent run tools without asking for approval each time'
      }
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent ${
        isOn
          ? 'border-accent-bg bg-accent-soft text-accent-2 hover:bg-accent-bg'
          : 'border-transparent text-ink-2 hover:bg-surface-2 hover:text-ink'
      }`}
    >
      {isOn ? (
        <CheckIcon size={12} className="shrink-0" />
      ) : (
        <ShieldIcon size={12} className="shrink-0 text-ink-3" />
      )}
      <span className="hidden sm:inline">Auto-approve</span>
      <span className="sm:hidden">Auto</span>
    </button>
  );
}
