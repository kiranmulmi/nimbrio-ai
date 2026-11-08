import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Badge } from '../../components/Badge';
import { CodeHighlight } from '../../components/CodeHighlight';
import { CodeText } from '../../components/CodeText';
import { Spinner } from '../../components/Spinner';
import { inlineArgs, prettyJson } from '../../lib/format';
import { ChevronRightIcon, CrossIcon } from '../../lib/icons';
import { languageForPath } from '../../lib/languages';
import type { ToolItem } from './conversation';
import { toolIcon } from './toolIcon';
import { ToolInput } from './ToolInput';

/** A call's status: a spinner while it runs, a cross if it failed, else the tool's own icon. */
function StepIcon({ name, state }: { name: string; state: ToolItem['state'] }) {
  if (state === 'running') {
    return (
      <span className="grid h-5 w-5 place-items-center">
        <Spinner size={10} label="Running" />
      </span>
    );
  }
  if (state === 'error') {
    return (
      <span className="grid h-5 w-5 place-items-center text-danger">
        <CrossIcon size={12} />
      </span>
    );
  }
  const Icon = toolIcon(name);
  return (
    <span className="grid h-5 w-5 place-items-center text-ink-3">
      <Icon size={13} />
    </span>
  );
}

/** How close to the end (px) still counts as "at the newest call". */
const NEAR_END = 24;

/**
 * A run of consecutive tool calls: plain rows on the chat background, no card around them.
 * A long run scrolls inside a capped box that stays on the newest call (unless the reader has
 * scrolled up), with the older calls fading out at the top edge.
 */
export function ToolSteps({ items }: { items: readonly ToolItem[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const isPinned = useRef(true);
  const [isFaded, setIsFaded] = useState(false);

  const update = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    isPinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_END;
    setIsFaded(node.scrollTop > 0);
  }, []);

  // A new call (not a row opened by the reader): follow it if we were at the end.
  useLayoutEffect(() => {
    const node = ref.current;
    if (node && isPinned.current) node.scrollTop = node.scrollHeight;
    update();
  }, [items.length, update]);

  return (
    <div
      ref={ref}
      onScroll={update}
      className={`flex max-h-[22rem] flex-col gap-px overflow-y-auto [&>*]:shrink-0 ${
        isFaded ? '[mask-image:linear-gradient(to_bottom,transparent,black_3rem)]' : ''
      }`}
    >
      {items.map((item) => (
        <ToolStep key={item.key} item={item} />
      ))}
    </div>
  );
}

/** read_file's header on a partial read: "[path: lines 1-200 of 333. …]". */
const READ_HEADER = /^\[[^\n]*: lines \d+-\d+ of \d+\.[^\n]*\]\n/;

/** The `path` argument of a call, if it has one. */
function pathArg(args: string): string | null {
  try {
    const parsed: unknown = JSON.parse(args);
    const path =
      typeof parsed === 'object' && parsed !== null ? (parsed as { path?: unknown }).path : null;
    return typeof path === 'string' ? path : null;
  } catch {
    return null;
  }
}

/**
 * A finished call's result: a file read is coloured as code for its file type (its line-range
 * header stays plain), anything else as before (JSON coloured, other text plain).
 */
function ResultText({ item }: { item: ToolItem }) {
  const path = item.name === 'read_file' ? pathArg(item.args) : null;
  const language = path ? languageForPath(path) : null;
  if (!language) return <CodeText text={prettyJson(item.result)} />;
  const header = READ_HEADER.exec(item.result)?.[0] ?? '';
  return (
    <>
      {header && <span className="text-ink-3">{header}</span>}
      <CodeHighlight code={item.result.slice(header.length)} language={language} />
    </>
  );
}

/** One tool call. Click it to see the input and result, which open in a card below it. */
export function ToolStep({ item }: { item: ToolItem }) {
  const summary = inlineArgs(item.args);
  return (
    <details className="group text-[12.5px]">
      <summary className="flex h-8 cursor-pointer list-none items-center gap-2.5 rounded-lg px-2.5 text-[11px] transition-colors hover:bg-surface group-open:bg-surface [&::-webkit-details-marker]:hidden">
        <StepIcon name={item.name} state={item.state} />
        <span className="shrink-0 font-mono font-semibold text-ink-3">{item.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-ink-3 opacity-75">{summary}</span>
        {item.state === 'error' && <Badge tone="red">failed</Badge>}
        <ChevronRightIcon
          size={10}
          className="shrink-0 text-ink-4 transition-transform group-open:rotate-90"
        />
      </summary>
      <div className="chat-card mb-2 ml-[30px] mt-1 grid gap-px overflow-hidden bg-line-2">
        <div className="bg-surface px-3 py-2.5">
          <div className="eyebrow mb-1.5">Input</div>
          <ToolInput tool={item.name} input={item.args} />
        </div>
        <div className="bg-surface px-3 py-2.5">
          <div className="eyebrow mb-1.5">Result</div>
          <pre
            className={`max-h-[260px] overflow-auto whitespace-pre-wrap font-mono text-[12px] [overflow-wrap:anywhere] ${
              item.state === 'error' ? 'text-danger' : 'text-ink-2'
            }`}
          >
            {item.state === 'error' ? item.result : <ResultText item={item} />}
          </pre>
        </div>
      </div>
    </details>
  );
}
