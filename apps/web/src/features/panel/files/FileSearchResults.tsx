import type { ReactNode } from 'react';
import type { FileSearchResult } from '@app/shared';
import { Spinner } from '../../../components/Spinner';
import { plural } from '../../../lib/format';
import { FileTintIcon } from '../../../lib/icons';
import { fileTint } from './fileTint';

/** `text` with every case-insensitive `query` marked. */
function Marked({ text, query }: { text: string; query: string }) {
  const needle = query.toLowerCase();
  if (!needle) return <>{text}</>;
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let from = 0;
  for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-[3px] bg-accent-bg px-px text-ink">
        {text.slice(at, at + needle.length)}
      </mark>,
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function splitPath(path: string) {
  const slash = path.lastIndexOf('/');
  return { folder: slash >= 0 ? path.slice(0, slash + 1) : '', name: path.slice(slash + 1) };
}

const ROW =
  'flex w-full items-center gap-2 px-4 text-left font-mono text-[12.5px] transition-colors hover:bg-accent-soft disabled:cursor-wait';

/**
 * The Files panel's search results: matching files (Name), or matching lines grouped by file
 * (Content). Clicking one opens it in the preview, at that line for a content match.
 */
export function FileSearchResults({
  result,
  query,
  isSearching,
  error,
  opening,
  onOpen,
}: {
  result: FileSearchResult | null;
  query: string;
  isSearching: boolean;
  error: string | null;
  opening: string | null;
  onOpen: (path: string, line?: number) => void;
}) {
  if (error) return <p className="px-4 py-4 text-[13px] text-danger">{error}</p>;
  if (!result) {
    return (
      <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-3">
        <Spinner size={12} /> Searching…
      </p>
    );
  }

  const count =
    result.mode === 'names'
      ? plural(result.paths.length, 'file')
      : `${plural(
          result.files.reduce((sum, file) => sum + file.lines.length + file.moreLines, 0),
          'match',
          'matches',
        )} in ${plural(result.files.length, 'file')}`;
  const isEmpty = result.mode === 'names' ? !result.paths.length : !result.files.length;

  return (
    <div className={`pb-2 transition-opacity ${isSearching ? 'opacity-60' : ''}`}>
      <p className="px-4 pb-1 pt-2.5 text-[11.5px] text-ink-3">
        {isEmpty ? (
          <>
            No {result.mode === 'names' ? 'file names' : 'files'} contain “{result.query}”.
          </>
        ) : (
          <>
            {count}
            {result.isTruncated && ' · showing the first ones, narrow the search to see more'}
          </>
        )}
      </p>

      {result.mode === 'names'
        ? result.paths.map((path) => {
            const { folder, name } = splitPath(path);
            return (
              <button
                key={path}
                type="button"
                title={path}
                disabled={opening === path}
                onClick={() => onOpen(path)}
                className={`${ROW} py-[5px]`}
              >
                <FileTintIcon size={14} className={`shrink-0 ${fileTint(name).icon}`} />
                <span className="min-w-0 truncate">
                  <span className="text-ink">
                    <Marked text={name} query={query} />
                  </span>
                  {folder && (
                    <span className="ml-2 text-[11.5px] text-ink-3">
                      <Marked text={folder.replace(/\/$/, '')} query={query} />
                    </span>
                  )}
                </span>
                {opening === path && <Spinner size={11} />}
              </button>
            );
          })
        : result.files.map((file) => {
            const { folder, name } = splitPath(file.path);
            return (
              <div key={file.path} className="mt-1">
                <button
                  type="button"
                  title={file.path}
                  disabled={opening === file.path}
                  onClick={() => onOpen(file.path, file.lines[0]?.line)}
                  className={`${ROW} py-1`}
                >
                  <FileTintIcon size={14} className={`shrink-0 ${fileTint(name).icon}`} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-ink">{name}</span>
                    {folder && (
                      <span className="ml-2 text-[11.5px] text-ink-3">
                        {folder.replace(/\/$/, '')}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 rounded-full bg-subtle px-1.5 text-[11px] tabular-nums text-ink-3">
                    {file.lines.length + file.moreLines}
                  </span>
                </button>
                {file.lines.map((hit) => (
                  <button
                    key={hit.line}
                    type="button"
                    disabled={opening === file.path}
                    onClick={() => onOpen(file.path, hit.line)}
                    className={`${ROW} items-baseline py-[3px] pl-[38px] text-[12px]`}
                  >
                    <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-ink-4">
                      {hit.line}
                    </span>
                    <span className="min-w-0 truncate whitespace-pre text-ink-2">
                      <Marked text={hit.text.trimStart()} query={query} />
                    </span>
                  </button>
                ))}
                {file.moreLines > 0 && (
                  <p className="py-[3px] pl-[80px] text-[11.5px] text-ink-3">
                    and {plural(file.moreLines, 'more line')}
                  </p>
                )}
              </div>
            );
          })}
    </div>
  );
}
