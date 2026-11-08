import { useMemo, type ReactNode } from 'react';
import { useHighlighter } from '../../../components/CodeHighlight';
import { languageForPath } from '../../../lib/languages';

type LineKind = 'hunk' | 'context' | 'add' | 'del' | 'note';

interface DiffLine {
  kind: LineKind;
  text: string;
  oldNumber: number | null;
  newNumber: number | null;
  /** its line in the old side (context, removed) or the new side (context, added) */
  side: 'old' | 'new' | null;
  sideIndex: number;
}

/**
 * A unified diff as rows: the file header lines (diff --git, index, ---, +++) are dropped,
 * each hunk starts with its @@ line, and every row knows its old and new line number.
 */
function parseDiff(diff: string): { lines: DiffLine[]; oldText: string; newText: string } {
  const lines: DiffLine[] = [];
  const oldSide: string[] = [];
  const newSide: string[] = [];
  let oldNumber = 0;
  let newNumber = 0;
  let isInHunk = false;
  for (const raw of diff.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) {
      isInHunk = true;
      oldNumber = Number(hunk[1]);
      newNumber = Number(hunk[2]);
      lines.push({
        kind: 'hunk',
        text: raw,
        oldNumber: null,
        newNumber: null,
        side: null,
        sideIndex: 0,
      });
      continue;
    }
    if (!isInHunk) continue;
    const mark = raw.charAt(0);
    const text = raw.slice(1);
    if (mark === '+') {
      lines.push({
        kind: 'add',
        text,
        oldNumber: null,
        newNumber,
        side: 'new',
        sideIndex: newSide.length,
      });
      newSide.push(text);
      newNumber++;
    } else if (mark === '-') {
      lines.push({
        kind: 'del',
        text,
        oldNumber,
        newNumber: null,
        side: 'old',
        sideIndex: oldSide.length,
      });
      oldSide.push(text);
      oldNumber++;
    } else if (mark === ' ') {
      lines.push({
        kind: 'context',
        text,
        oldNumber,
        newNumber,
        side: 'new',
        sideIndex: newSide.length,
      });
      oldSide.push(text);
      newSide.push(text);
      oldNumber++;
      newNumber++;
    } else if (mark === '\\') {
      lines.push({
        kind: 'note',
        text: raw.slice(2),
        oldNumber: null,
        newNumber: null,
        side: null,
        sideIndex: 0,
      });
    } else if (raw.startsWith('diff --git')) {
      isInHunk = false;
    }
  }
  return { lines, oldText: oldSide.join('\n'), newText: newSide.join('\n') };
}

const ROW: Record<LineKind, string> = {
  hunk: 'bg-accent-soft text-ink-3',
  context: '',
  add: 'bg-success-bg',
  del: 'bg-danger-bg',
  note: 'text-ink-3 italic',
};

const MARK: Record<LineKind, ReactNode> = {
  hunk: '',
  context: ' ',
  add: <span className="text-success">+</span>,
  del: <span className="text-danger">−</span>,
  note: '',
};

/**
 * One file's changes: removed lines in red, added in green, both coloured as code (each
 * side is highlighted whole, so partial lines still read right), with old and new line
 * numbers.
 */
export function DiffView({ path, diff }: { path: string; diff: string }) {
  const parsed = useMemo(() => parseDiff(diff), [diff]);
  const language = languageForPath(path);
  const highlighter = useHighlighter();
  const sides = useMemo(
    () =>
      highlighter && language
        ? {
            old: highlighter.highlightLines(parsed.oldText, language),
            new: highlighter.highlightLines(parsed.newText, language),
          }
        : null,
    [highlighter, language, parsed],
  );

  if (parsed.lines.length === 0) {
    return (
      <p className="px-3 py-2.5 text-[12.5px] text-ink-3">
        No line changes (mode or permissions only).
      </p>
    );
  }

  return (
    <div className="max-h-[520px] overflow-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
        <tbody>
          {parsed.lines.map((line, index) => {
            const coloured = line.side ? sides?.[line.side]?.[line.sideIndex] : undefined;
            const isWide = line.kind === 'hunk' || line.kind === 'note';
            return (
              <tr key={index} className={ROW[line.kind]}>
                {isWide ? (
                  <td colSpan={4} className="whitespace-pre px-3 py-0.5 text-[11.5px]">
                    {line.text}
                  </td>
                ) : (
                  <>
                    <td className="w-[1%] select-none whitespace-nowrap pl-2 pr-1.5 text-right text-ink-4 tabular-nums">
                      {line.oldNumber ?? ''}
                    </td>
                    <td className="w-[1%] select-none whitespace-nowrap pr-2 text-right text-ink-4 tabular-nums">
                      {line.newNumber ?? ''}
                    </td>
                    <td className="w-[1%] select-none pr-1.5">{MARK[line.kind]}</td>
                    <td className="whitespace-pre pr-3 text-ink">
                      {coloured?.length ? coloured : line.text || ' '}
                    </td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
