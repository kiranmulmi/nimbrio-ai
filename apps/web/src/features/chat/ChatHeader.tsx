import { Badge } from '../../components/Badge';
import { IconButton } from '../../components/IconButton';
import { ThemeToggle } from '../../layout/ThemeToggle';
import { ConversationIcon, PanelIcon } from '../../lib/icons';

/**
 * The chat's toolbar: its title and whether the agent is working, with the theme at the end
 * (wide screens; narrower ones have it in the app bar). While a side is hidden, a button
 * brings it back: the chats sidebar (wide screens) in front of the title, the panel at the end.
 */
export function ChatHeader({
  title,
  isBusy,
  isPanelShown,
  onTogglePanel,
  onShowSidebar,
}: {
  title: string;
  isBusy: boolean;
  isPanelShown: boolean;
  onTogglePanel: () => void;
  /** Set while the sidebar is collapsed (wide screens only). */
  onShowSidebar?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        {onShowSidebar && (
          <IconButton
            onClick={onShowSidebar}
            aria-controls="chat-sidebar"
            aria-expanded={false}
            aria-label="Expand the sidebar"
            title="Expand the sidebar"
            className="hidden xl:grid"
          >
            <PanelIcon size={15} className="-scale-x-100" />
          </IconButton>
        )}
        <span
          aria-hidden
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent-2"
        >
          <ConversationIcon size={15} />
        </span>
        <h1 title={title} className="min-w-0 truncate text-[16px] font-extrabold text-ink">
          {title}
        </h1>
        {isBusy && (
          <Badge tone="blue" icon={<span aria-hidden className="live-dot h-1.5 w-1.5" />}>
            Working
          </Badge>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <span className="hidden xl:contents">
          <ThemeToggle />
        </span>
        {/* While the panel is open its own header has the button that hides it. */}
        {!isPanelShown && (
          <IconButton
            onClick={onTogglePanel}
            aria-controls="side-panel"
            aria-expanded={false}
            title="Show plan, memory and files"
            aria-label="Show plan, memory and files"
          >
            <PanelIcon size={15} />
          </IconButton>
        )}
      </div>
    </header>
  );
}
