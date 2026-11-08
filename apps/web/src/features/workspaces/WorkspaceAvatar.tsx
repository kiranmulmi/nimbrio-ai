import type { CSSProperties } from 'react';

function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const [first, second] = words;
  const letters = first && second ? `${first[0] ?? ''}${second[0] ?? ''}` : name.trim().slice(0, 2);
  return letters.toUpperCase() || '?';
}

/**
 * The theme's cool colours, as gradient pairs: teal, navy, sea blue, deep teal and slate.
 * Each workspace keeps one, so switching is easy to notice without leaving the palette.
 */
const SWATCHES = [
  ['#3fd2c2', '#0c8f81'],
  ['#4a6a8f', '#10263f'],
  ['#4fb8d8', '#1d6f8f'],
  ['#2a9d8f', '#0b4f4a'],
  ['#6f93a6', '#34566b'],
] as const;

/** A stable swatch per workspace id (FNV-1a, so similar ids still spread out). */
function swatchOf(id: string): readonly [string, string] {
  let hash = 0x811c9dc5;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return SWATCHES[hash % SWATCHES.length] ?? SWATCHES[0];
}

export function WorkspaceAvatar({
  id,
  name,
  size = 'md',
}: {
  id: string;
  name: string;
  size?: 'md' | 'sm';
}) {
  const [from, to] = swatchOf(id);
  const style = { '--ws-from': from, '--ws-to': to } as CSSProperties;
  return (
    <span
      aria-hidden
      style={style}
      // A gradient tile with white initials and a soft bevel, like the brand tile.
      className={`grid shrink-0 place-items-center bg-[linear-gradient(145deg,var(--ws-from),var(--ws-to))] font-extrabold tracking-[0.02em] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),inset_0_-1px_0_rgb(0_0_0/0.15),0_2px_6px_-2px_rgb(16_38_63/0.35)] [text-shadow:0_1px_1px_rgb(0_0_0/0.18)] ${
        size === 'sm' ? 'h-6 w-6 rounded-md text-[9.5px]' : 'h-8 w-8 rounded-lg text-[11px]'
      }`}
    >
      {initials(name)}
    </span>
  );
}
