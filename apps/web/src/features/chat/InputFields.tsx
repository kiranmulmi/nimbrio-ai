import { useState, type ReactNode } from 'react';
import { CodeText } from '../../components/CodeText';
import { Markdown } from '../../components/Markdown';
import { prettyJson } from '../../lib/format';

const isPrimitive = (value: unknown): value is string | number | boolean | null =>
  value === null || ['string', 'number', 'boolean'].includes(typeof value);

/** Headings, lists, tables, bold, inline code or links: worth rendering as Markdown. */
const MARKDOWN =
  /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|.*\|)|\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/;

/** Past this, a string is a block of its own rather than a value on the label's line. */
const SHORT_TEXT = 90;

/** `html_url` -> "Html url", `timeoutSeconds` -> "Timeout seconds". */
function labelOf(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function asJson(text: string): unknown {
  const trimmed = text.trim();
  if (!/^[[{]/.test(trimmed)) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function JsonBlock({ value }: { value: unknown }) {
  return (
    <pre className="max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg border border-line-2 bg-subtle px-2.5 py-2 font-mono text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">
      <CodeText text={prettyJson(JSON.stringify(value) ?? 'null')} />
    </pre>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center truncate rounded-md border border-line-2 bg-subtle px-1.5 py-px font-mono text-[12px] text-ink">
      {children}
    </span>
  );
}

/** One argument's value, shown as what it is. */
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-ink-3">none</span>;
  if (typeof value === 'boolean') return <Chip>{value ? 'yes' : 'no'}</Chip>;
  if (typeof value === 'number') return <span className="tabular-nums">{value}</span>;
  if (typeof value === 'string') {
    if (value === '') return <span className="text-ink-3">empty</span>;
    const json = asJson(value);
    if (json !== undefined) return <JsonBlock value={json} />;
    if (MARKDOWN.test(value)) {
      return (
        <div className="max-h-[320px] overflow-auto rounded-lg border border-line-2 bg-surface px-3 py-2">
          <Markdown text={value} className="text-[13px] leading-relaxed text-ink" />
        </div>
      );
    }
    if (value.length > SHORT_TEXT || value.includes('\n')) {
      return (
        <p className="max-h-[240px] overflow-auto whitespace-pre-wrap rounded-lg border border-line-2 bg-surface px-3 py-2 leading-relaxed [overflow-wrap:anywhere]">
          {value}
        </p>
      );
    }
    return <span className="[overflow-wrap:anywhere]">{value}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-3">none</span>;
    if (value.every(isPrimitive) && value.every((item) => String(item).length <= SHORT_TEXT)) {
      return (
        <span className="flex flex-wrap gap-1">
          {value.map((item, index) => (
            <Chip key={index}>{String(item)}</Chip>
          ))}
        </span>
      );
    }
  }
  return <JsonBlock value={value} />;
}

/**
 * A tool's arguments as a labelled list instead of raw JSON: short values on one line, lists
 * as chips, long text in a box (Markdown rendered), nested data as coloured JSON. "Raw" shows
 * the exact JSON the tool gets.
 */
export function InputFields({ value }: { value: Record<string, unknown> }) {
  const [isRaw, setIsRaw] = useState(false);
  const entries = Object.entries(value).filter(([, item]) => item !== undefined);

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line-2 bg-subtle px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-3">
          {entries.length === 1 ? '1 argument' : `${entries.length} arguments`}
        </span>
        <button
          type="button"
          onClick={() => setIsRaw((current) => !current)}
          aria-pressed={isRaw}
          className="rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-ink-3 transition-colors hover:bg-surface hover:text-accent-2"
        >
          {isRaw ? 'Formatted' : 'Raw JSON'}
        </button>
      </div>
      {isRaw ? (
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink [overflow-wrap:anywhere]">
          <CodeText text={prettyJson(JSON.stringify(value))} />
        </pre>
      ) : entries.length === 0 ? (
        <p className="px-3 py-2.5 text-[13px] text-ink-3">No arguments.</p>
      ) : (
        <dl className="max-h-[460px] divide-y divide-line-2 overflow-auto">
          {entries.map(([key, item]) => (
            <div
              key={key}
              className="grid gap-x-4 gap-y-1 px-3 py-2 text-[13px] text-ink sm:grid-cols-[132px_minmax(0,1fr)]"
            >
              <dt className="pt-px text-[12.5px] font-medium text-ink-3" title={key}>
                {labelOf(key)}
              </dt>
              <dd className="min-w-0">
                <Value value={item} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
