import type { ReactNode } from 'react';
import { CheckIcon, LogoIcon } from '../../lib/icons';

const HIGHLIGHTS = [
  'Chats that plan, call tools and ask before changing anything',
  'Works in your own folders, with the models you choose',
  'Pick up any chat in the browser or the terminal',
];

function Brand({ isOnColour = false }: { isOnColour?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="brand-mark" aria-hidden>
        <LogoIcon />
      </span>
      <span
        className={`text-[18px] font-extrabold tracking-[-0.02em] ${isOnColour ? 'text-white' : 'text-ink'}`}
      >
        Nimbrio {isOnColour ? 'AI' : <span className="highlight">AI</span>}
      </span>
    </div>
  );
}

/** The brand side of the screen, shown next to the form on wide screens. */
function BrandPanel() {
  return (
    <aside className="brand-panel relative hidden w-[44%] max-w-[580px] shrink-0 flex-col justify-between p-12 text-white lg:flex">
      <Brand isOnColour />
      <div>
        <h2 className="max-w-[420px] text-[32px] font-extrabold leading-[1.15] tracking-[-0.02em]">
          Your AI agent, working right where your files are.
        </h2>
        <ul className="mt-8 space-y-3.5">
          {HIGHLIGHTS.map((line) => (
            <li key={line} className="flex items-start gap-3 text-[15px] text-white/90">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
                <CheckIcon size={11} strokeWidth={2.4} />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[13px] text-white/70">Runs on your machine. Your keys stay with you.</p>
    </aside>
  );
}

/**
 * The sign-in screens: a form column, with the brand panel beside it on wide screens and the
 * brand above it on narrow ones.
 */
export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full bg-surface">
      <BrandPanel />
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 lg:hidden">
            <Brand />
          </div>
          <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </div>
    </main>
  );
}
