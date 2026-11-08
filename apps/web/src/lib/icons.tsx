import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export function PlusIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} {...rest}>
      <path d="M8 3.5v9M3.5 8h9" />
    </svg>
  );
}

export function RefreshIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
      <path d="M13.5 2.5v3h-3" />
    </svg>
  );
}

export function EditIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M11.5 2.5l2 2-8 8-3 1 1-3 8-8z" />
    </svg>
  );
}

/** A pencil over an open square: start something new, e.g. a new chat. */
export function ComposeIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7.5 2.5H4.25A1.75 1.75 0 0 0 2.5 4.25v7.5c0 .97.78 1.75 1.75 1.75h7.5c.97 0 1.75-.78 1.75-1.75V8.5" />
      <path d="M11.9 2.1a1.36 1.36 0 0 1 1.92 1.92L8.4 9.45 6 10l.55-2.4 5.35-5.5z" />
    </svg>
  );
}

export function TrashIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M3 4h10M6.5 4V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1M5 4l.7 9a1.5 1.5 0 0 0 1.5 1.4h1.6A1.5 1.5 0 0 0 10.3 13L11 4" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9 3.5 4.5 8 9 12.5M4.5 8h8" />
    </svg>
  );
}

export function CopyIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5V3.8A1.3 1.3 0 0 0 9.2 2.5H3.8a1.3 1.3 0 0 0-1.3 1.3v5.4a1.3 1.3 0 0 0 1.3 1.3h1.7" />
    </svg>
  );
}

export function WrapIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 4h11M2.5 8h9a2 2 0 0 1 0 4H8.5M10 10.5 8.5 12l1.5 1.5M2.5 12H5" />
    </svg>
  );
}

export function CheckIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} {...rest}>
      <path d="M3 8.5l3.2 3.2L13 5" />
    </svg>
  );
}

/** A milestone flag: the plan tools' calls (a finished plan step uses the check). */
export function FlagIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8} {...rest}>
      <path d="M4 14V2.5" />
      <path d="M4 3h8l-1.75 2.75L12 8.5H4" />
    </svg>
  );
}

export function CrossIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} {...rest}>
      <path d="M4.5 4.5l7 7m0-7l-7 7" />
    </svg>
  );
}

export function DashIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={2} {...rest}>
      <path d="M4 8h8" />
    </svg>
  );
}

export function WarnIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8} {...rest}>
      <path d="M8 2.5l6.5 11h-13z" />
      <path d="M8 6.5v3.5" />
      <circle cx="8" cy="12" r=".6" fill="currentColor" />
    </svg>
  );
}

/** A circle with an exclamation mark: something failed. */
export function AlertCircleIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8} {...rest}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5" />
      <circle cx="8" cy="11" r=".6" fill="currentColor" />
    </svg>
  );
}

/** A circle with an "i": neutral information. */
export function InfoIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.8} {...rest}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.5V11" />
      <circle cx="8" cy="5" r=".6" fill="currentColor" />
    </svg>
  );
}

export function MenuIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 4.5h11" />
      <path d="M2.5 8h11" />
      <path d="M2.5 11.5h11" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 12, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M4 6.5 8 10.5l4-4" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 12, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 3.5 10.5 8 6 12.5" />
    </svg>
  );
}

export function GearIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} strokeWidth={1.3} {...rest}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M13 9.5l1 .7-1.3 2.3-1.1-.5a4.8 4.8 0 0 1-1.3.7L10.1 14H7.5l-.2-1.3a4.8 4.8 0 0 1-1.3-.7l-1.1.5-1.3-2.3 1-.7a4.8 4.8 0 0 1 0-1.5l-1-.7 1.3-2.3 1.1.5a4.8 4.8 0 0 1 1.3-.7L7.5 2h2.6l.2 1.3a4.8 4.8 0 0 1 1.3.7l1.1-.5 1.3 2.3-1 .7a4.8 4.8 0 0 1 0 1.5z" />
    </svg>
  );
}

export function PanelIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <path d="M10 2.5v11" />
    </svg>
  );
}

export function ExpandIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6.5 3H3v3.5M9.5 13H13V9.5M3 3l4 4M13 13 9 9" />
    </svg>
  );
}

export function FileIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z" />
      <path d="M9 2v4h4" />
    </svg>
  );
}

export function FolderIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.7h4.7A1.5 1.5 0 0 1 14 6.2v5.3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" />
    </svg>
  );
}

/** A file with a soft fill in its colour, for the file tree's per-type tint. */
export function FileTintIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path
        d="M9 2H4.5A1.5 1.5 0 0 0 3 3.5v9A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6z"
        fill="currentColor"
        fillOpacity={0.16}
      />
      <path d="M9 2v4h4" />
    </svg>
  );
}

/** A closed folder with a soft fill. */
export function FolderTintIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path
        d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.7h4.7A1.5 1.5 0 0 1 14 6.2v5.3a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"
        fill="currentColor"
        fillOpacity={0.2}
      />
    </svg>
  );
}

/** An open folder with a soft fill. */
export function FolderOpenIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2 11.5v-7A1.5 1.5 0 0 1 3.5 3h2.8l1.5 1.7h4.2A1.5 1.5 0 0 1 13.5 6.2V7" />
      <path
        d="M2.2 12.4 4 8a1.5 1.5 0 0 1 1.4-1h8.1a.8.8 0 0 1 .75 1.1l-1.6 4.1a1.2 1.2 0 0 1-1.1.8H3.3a1.1 1.1 0 0 1-1.1-.6z"
        fill="currentColor"
        fillOpacity={0.2}
      />
    </svg>
  );
}

export function PaperclipIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M13.2 7.6 8.1 12.7a3.3 3.3 0 0 1-4.7-4.7l5.3-5.3a2.2 2.2 0 0 1 3.1 3.1L6.6 11a1.1 1.1 0 0 1-1.6-1.6l4.8-4.8" />
    </svg>
  );
}

/** Two chain links: a web address. */
export function LinkIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6.7 9.3a2.8 2.8 0 0 0 4 0l2.2-2.2a2.8 2.8 0 0 0-4-4l-.9.9" />
      <path d="M9.3 6.7a2.8 2.8 0 0 0-4 0L3.1 8.9a2.8 2.8 0 0 0 4 4l.9-.9" />
    </svg>
  );
}

/** A play triangle: run. */
export function PlayIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon({ size = 13, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export function SendIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </svg>
  );
}

export function TargetIcon({ size = 20, ...rest }: IconProps) {
  return (
    <svg {...base(size)} viewBox="0 0 20 20" {...rest}>
      <circle cx="10" cy="10" r="7.5" />
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function MoonIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M13.5 9.4A5.8 5.8 0 0 1 6.6 2.5a5.8 5.8 0 1 0 6.9 6.9Z" />
    </svg>
  );
}

/** The app's mark: a four-point spark, drawn in the current colour for the brand tile. */
export function LogoIcon({ size = 18, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden {...rest}>
      <path d="M8 1.5c.4 3.3 1.9 4.9 5.5 5.5v2c-3.6.6-5.1 2.2-5.5 5.5C7.6 11.2 6.1 9.6 2.5 9V7C6.1 6.4 7.6 4.8 8 1.5z" />
    </svg>
  );
}

export function SunIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="8" r="2.8" />
      <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
    </svg>
  );
}

export function MonitorIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2" y="2.5" width="12" height="8.5" rx="1.5" />
      <path d="M5.5 13.5h5M8 11v2.5" />
    </svg>
  );
}

/** Two speech bubbles: a conversation, e.g. in front of the chat's title. */
export function ConversationIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M10 5V3.8a1.3 1.3 0 0 0-1.3-1.3H3.3A1.3 1.3 0 0 0 2 3.8v3.4a1.3 1.3 0 0 0 1.3 1.3H4V10l1.6-1.4" />
      <path d="M7.3 5.5h5.4A1.3 1.3 0 0 1 14 6.8v3.4a1.3 1.3 0 0 1-1.3 1.3H12V13l-1.8-1.5H7.3A1.3 1.3 0 0 1 6 10.2V6.8a1.3 1.3 0 0 1 1.3-1.3z" />
    </svg>
  );
}

export function ServerIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2.5" y="2.5" width="11" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="11" height="4.5" rx="1" />
      <path d="M5 4.75h.01M5 11.25h.01" strokeWidth={2.2} />
    </svg>
  );
}

export function ShieldIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 1.8l5 1.9v3.9c0 3.1-2.1 5.6-5 6.6-2.9-1-5-3.5-5-6.6V3.7l5-1.9z" />
    </svg>
  );
}

export function ChatIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 4.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7l-3 2.5v-2.5h0a2 2 0 0 1-1.5-2v-5z" />
    </svg>
  );
}

export function PlusCircleIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden {...rest}>
      <circle cx="8" cy="8" r="7" fill="currentColor" />
      <path d="M8 5v6M5 8h6" stroke="var(--surface)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/** A pulse line: something keeps running (background tasks). */
export function PulseIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M1.5 8.5h2.75l1.75-4.5 3 8 1.75-3.5h3.75" />
    </svg>
  );
}

/** A terminal window with a prompt. */
export function TerminalIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="1.75" y="2.5" width="12.5" height="11" rx="1.75" />
      <path d="m4.5 6.25 2 1.75-2 1.75M8 10h3.5" />
    </svg>
  );
}

/** A screen with an arrow coming down into it: install as an app. */
export function InstallIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M5.5 2.5H3.25a1.5 1.5 0 0 0-1.5 1.5v6.5a1.5 1.5 0 0 0 1.5 1.5h9.5a1.5 1.5 0 0 0 1.5-1.5V4a1.5 1.5 0 0 0-1.5-1.5H10.5" />
      <path d="M8 1.5v6.25M5.75 5.5 8 7.75l2.25-2.25M5.5 14.5h5" />
    </svg>
  );
}

/** An open book with a bookmark: a skill (instructions for a kind of task). */
export function SkillIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 4.2C6.6 3.2 4.6 2.8 2.5 3v9c2.1-.2 4.1.2 5.5 1.2 1.4-1 3.4-1.4 5.5-1.2V3c-2.1-.2-4.1.2-5.5 1.2z" />
      <path d="M8 4.2v9M10.5 3.3v3.2l1-.7 1 .7V3.1" />
    </svg>
  );
}

/** A microphone: voice input. */
export function MicIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="5.75" y="1.75" width="4.5" height="8" rx="2.25" />
      <path d="M3.25 7.5a4.75 4.75 0 0 0 9.5 0M8 12.25v2" />
    </svg>
  );
}

/** A phone handset laid down: hang up / end a call. */
export function PhoneHangUpIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path
        d="M1.6 9.1c3.6-3.5 9.2-3.5 12.8 0 .4.4.4 1 0 1.4l-1.3 1.3c-.3.3-.8.4-1.2.1l-1.7-1.1a1 1 0 0 1-.4-.9l.1-1.3a7.6 7.6 0 0 0-3.8 0l.1 1.3c0 .4-.1.7-.4.9l-1.7 1.1c-.4.3-.9.2-1.2-.1L1.6 10.5c-.4-.4-.4-1 0-1.4z"
        fill="currentColor"
        strokeWidth={0.6}
      />
    </svg>
  );
}

/** Two opposite arrows: switch to another one. */
export function SwitchIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8" />
      <path d="M13.5 10.5h-10M6 8l-2.5 2.5L6 13" />
    </svg>
  );
}

/** Three dots in a row: more actions. */
export function DotsIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="3.5" cy="8" r="0.9" fill="currentColor" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      <circle cx="12.5" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** Three dots in a column: a toolbar's menu of more actions. */
export function DotsVerticalIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="3.5" r="0.9" fill="currentColor" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      <circle cx="8" cy="12.5" r="0.9" fill="currentColor" />
    </svg>
  );
}

/** A page with a plus: a new file. */
export function FilePlusIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M9 1.75H4.25a1.5 1.5 0 0 0-1.5 1.5v9.5a1.5 1.5 0 0 0 1.5 1.5h7.5a1.5 1.5 0 0 0 1.5-1.5V6L9 1.75z" />
      <path d="M9 1.75V6h4.25M8 8.25v4M6 10.25h4" />
    </svg>
  );
}

/** A folder with a plus: a new folder. */
export function FolderPlusIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M1.75 4.25a1.5 1.5 0 0 1 1.5-1.5h3l1.5 1.75h5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-9.5a1.5 1.5 0 0 1-1.5-1.5v-7.75z" />
      <path d="M8 7.25v4M6 9.25h4" />
    </svg>
  );
}

/** Two branches joining: git changes. */
export function GitDiffIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-2 3.5-5.5 4.25" />
    </svg>
  );
}

/** A wand with sparkles, e.g. "improve this prompt". */
export function WandIcon({ size = 15, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M2.5 13.5 10 6" />
      <path d="m9 5 2 2" />
      <path d="M11.5 1.5v2M10.5 2.5h2M14 5.5v2M13 6.5h2M6 2v1.5M5.25 2.75h1.5" />
    </svg>
  );
}

export function SparkIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 1.5l1.6 4.9 4.9 1.6-4.9 1.6L8 14.5l-1.6-4.9L1.5 8l4.9-1.6L8 1.5z" />
    </svg>
  );
}

export function SearchIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5l3 3" />
    </svg>
  );
}

/** A light bulb: the agent's notes while it works, on the way to a tool call. */
export function BulbIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M8 1.5a4.5 4.5 0 0 0-2.6 8.2c.4.3.6.7.6 1.2V12h4v-1.1c0-.5.2-.9.6-1.2A4.5 4.5 0 0 0 8 1.5z" />
      <path d="M6.5 14.5h3" />
    </svg>
  );
}

export function BrainIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M6 2.5a2 2 0 0 0-2 2v.2A2.3 2.3 0 0 0 2.5 9a2.3 2.3 0 0 0 1.8 3.4A2 2 0 0 0 8 13V3.6A2 2 0 0 0 6 2.5z" />
      <path d="M10 2.5a2 2 0 0 1 2 2v.2A2.3 2.3 0 0 1 13.5 9a2.3 2.3 0 0 1-1.8 3.4A2 2 0 0 1 8 13" />
    </svg>
  );
}

export function CalculatorIcon({ size = 16, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
      <path d="M5 5.5h2M6 4.5v2M9 5.5h2M5 10.5h2M9 9.5h2M9 11.5h2" />
    </svg>
  );
}

export function GlobeIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.6 1.7 2.4 3.7 2.4 6S9.6 12.3 8 14c-1.6-1.7-2.4-3.7-2.4-6S6.4 3.7 8 2z" />
    </svg>
  );
}

export function ClockIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.75V8l2.25 1.5" />
    </svg>
  );
}

export function ImageIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <rect x="2" y="2.5" width="12" height="11" rx="1.75" />
      <circle cx="5.75" cy="6.25" r="1.1" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

/** An arrow out of a box: something moved or renamed. */
export function MoveIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M7 2.5H4A1.5 1.5 0 0 0 2.5 4v8A1.5 1.5 0 0 0 4 13.5h8a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5" />
    </svg>
  );
}

/** A wrench: a tool call with no icon of its own. */
export function WrenchIcon({ size = 14, ...rest }: IconProps) {
  return (
    <svg {...base(size)} {...rest}>
      <path d="M10.2 2.2a3.5 3.5 0 0 0-4 4.6L2.3 10.7a1.4 1.4 0 0 0 2 2l3.9-3.9a3.5 3.5 0 0 0 4.6-4l-2 2-1.8-.3-.3-1.8 2-2z" />
    </svg>
  );
}
