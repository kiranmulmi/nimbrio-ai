import type { ReactElement } from 'react';
import { MonitorIcon, MoonIcon, SunIcon } from '../lib/icons';
import { useTheme, type Theme } from '../lib/theme';

const OPTIONS: Array<{
  theme: Theme;
  label: string;
  icon: (props: { size?: number }) => ReactElement;
}> = [
  { theme: 'light', label: 'Light', icon: SunIcon },
  { theme: 'dark', label: 'Dark', icon: MoonIcon },
  { theme: 'system', label: 'System', icon: MonitorIcon },
];

/**
 * One button that cycles the theme: light, dark, then following the system setting. `sm` fits
 * the chat screen's 32px footer.
 */
export function ThemeToggle({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { theme, setTheme } = useTheme();
  const index = Math.max(
    0,
    OPTIONS.findIndex((option) => option.theme === theme),
  );
  const current = OPTIONS[index];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  if (!current || !next) return null;

  return (
    <button
      type="button"
      onClick={() => setTheme(next.theme)}
      aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}`}
      title={`Theme: ${current.label} (click for ${next.label.toLowerCase()})`}
      className={`grid shrink-0 place-items-center text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${
        size === 'sm' ? 'h-6 w-6 rounded-md' : 'h-8 w-8 rounded-lg'
      }`}
    >
      <current.icon size={size === 'sm' ? 14 : 16} />
    </button>
  );
}
