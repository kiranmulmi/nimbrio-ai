import { Fragment, useState } from 'react';
import type { ModelCallUsage, TokenGroup, Usage } from '@app/shared';
import { Modal } from '../../components/Modal';
import { compactNumber, plural } from '../../lib/format';
import { ChevronRightIcon } from '../../lib/icons';
import { MessageTime } from './MessageTime';
import {
  CALL_KIND_LABELS,
  TOKEN_GROUP_LABELS,
  callDuration,
  mergeGroups,
  sumUsage,
  usageParts,
  type MessageUsage,
  type UsageParts,
} from './tokenUsage';

/** What the popup shows: one reply's model calls, or the whole chat by message. */
export type UsageView = { kind: 'chat' } | { kind: 'reply'; key: string };

const exact = (value: number) => value.toLocaleString('en');
const percent = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–';

/** Which rows are folded open, by key. */
function useOpenSet() {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (key: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { isOpen: (key: string) => open.has(key), toggle };
}

function Chevron({ isOpen }: { isOpen: boolean }) {
  return (
    <ChevronRightIcon
      size={11}
      className={`shrink-0 text-ink-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
    />
  );
}

const SERIES = [
  { part: 'cached', label: 'Input from cache', swatch: 'bg-usage-cached' },
  { part: 'freshInput', label: 'New input', swatch: 'bg-usage-input' },
  { part: 'output', label: 'Output', swatch: 'bg-usage-output' },
] as const;

/**
 * The token usage breakdown: from a reply's steps line, each request it sent to the model
 * and what came back; from the chat's token line, each message's total, folding open to its
 * requests. Bars split each row into input read from the cache, new input and output.
 */
export function TokenUsageDialog({
  rows,
  view,
  onClose,
}: {
  /** the chat's finished replies, oldest first (`messageUsages`) */
  rows: MessageUsage[];
  view: UsageView;
  onClose: () => void;
}) {
  const reply = view.kind === 'reply' ? rows.find((row) => row.key === view.key) : undefined;
  if (view.kind === 'reply' && !reply) return null;
  const total = sumUsage(rows.map((row) => row.usage));

  return (
    <Modal
      title={reply ? 'Token usage: this reply' : 'Token usage: this chat'}
      titleFont="sans"
      size="lg"
      onClose={onClose}
    >
      <div className="flex flex-col gap-5 p-4 sm:p-5">
        {reply ? (
          <>
            <p className="text-[13px] text-ink-2">
              For: <span className="font-medium text-ink">{reply.label}</span>
              <MessageTime iso={reply.finishedAt} prefix=" · " />
            </p>
            <Totals
              usage={reply.usage}
              count={plural(reply.calls.length || reply.steps, 'model call')}
            />
            <Breakdowns calls={reply.calls} usage={reply.usage} />
            <Legend />
            <CallsTable calls={reply.calls} />
          </>
        ) : (
          <>
            <Totals usage={total} count={plural(rows.length, 'reply', 'replies')} />
            <Breakdowns calls={rows.flatMap((row) => row.calls)} usage={total} />
            <Legend />
            <MessagesTable rows={rows} />
          </>
        )}
        <p className="text-[12px] leading-relaxed text-ink-3">
          Every request sends the model everything again: instructions, tool definitions, the
          conversation so far and its tool results, so a large result costs tokens on each later
          step. Input from cache was read from the model server&apos;s prompt cache and is billed
          far lower. Totals are what the model server reported; it doesn&apos;t say what each part
          cost, so the parts are counted from the text sent and scaled to those totals.
        </p>
      </div>
    </Modal>
  );
}

/**
 * What the input and output went to, added up over `calls`. Calls saved before parts were
 * recorded have none, so the breakdown covers only the calls that have them.
 */
function Breakdowns({ calls, usage }: { calls: ModelCallUsage[]; usage: Usage }) {
  const known = calls.filter((call) => call.input.length > 0);
  if (known.length === 0) {
    // With no calls at all, the requests table below says why.
    if (calls.length === 0) return null;
    return (
      <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] text-ink-3">
        What each part cost wasn&apos;t recorded for these requests (they were made before it was).
      </p>
    );
  }
  const input = mergeGroups(known.map((call) => call.input));
  const output = mergeGroups(known.map((call) => call.output));
  const knownInput = known.reduce((sum, call) => sum + call.inputTokens, 0);
  return (
    <div className="flex flex-col gap-4">
      {known.length < calls.length || knownInput < usage.inputTokens ? (
        <p className="text-[12px] text-ink-3">
          Parts are known for {known.length} of {plural(calls.length || 1, 'request')} (saved before
          parts were recorded).
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <Composition title="What the input went to" groups={input} bar="bg-usage-input" />
        <Composition title="What the output went to" groups={output} bar="bg-usage-output" />
      </div>
    </div>
  );
}

/**
 * Groups as a ranked list of share bars (each bar is the group's share of the whole), each
 * folding open to its largest items.
 */
function Composition({
  title,
  groups,
  bar,
  isCompact = false,
}: {
  title: string;
  groups: TokenGroup[];
  /** the bar colour class */
  bar: string;
  /** inside a request's row: smaller heading */
  isCompact?: boolean;
}) {
  const { isOpen, toggle } = useOpenSet();
  const whole = groups.reduce((sum, group) => sum + group.tokens, 0);
  return (
    <section className="min-w-0">
      <h3
        className={`mb-1.5 flex items-baseline justify-between gap-2 font-semibold text-ink ${
          isCompact ? 'text-[12px]' : 'text-[13px]'
        }`}
      >
        {title}
        <span className="text-[11.5px] font-normal tabular-nums text-ink-3">
          {compactNumber(whole)} tokens
        </span>
      </h3>
      {groups.length === 0 ? (
        <p className="text-[12px] text-ink-3">Nothing recorded.</p>
      ) : (
        <ul className="divide-y divide-line-2 rounded-xl border border-line text-[12.5px]">
          {groups.map((group) => {
            const open = isOpen(group.id);
            return (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => toggle(group.id)}
                  aria-expanded={open}
                  className="grid w-full grid-cols-[minmax(0,1fr)_minmax(56px,28%)_48px_36px] items-center gap-2 px-2.5 py-1.5 text-left hover:bg-subtle"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Chevron isOpen={open} />
                    <span className="truncate text-ink">{TOKEN_GROUP_LABELS[group.id]}</span>
                  </span>
                  <ShareBar part={group.tokens} whole={whole} colour={bar} />
                  <span className={`${NUM} text-ink`} title={`about ${exact(group.tokens)} tokens`}>
                    {compactNumber(group.tokens)}
                  </span>
                  <span className={`${NUM} text-ink-3`}>{percent(group.tokens, whole)}</span>
                </button>
                {open && (
                  <ul className="border-t border-line-2 bg-subtle py-1 pl-7 pr-2.5">
                    {group.items.map((item) => (
                      <li
                        key={item.label}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(56px,28%)_48px_36px] items-center gap-2 py-1 text-[12px]"
                      >
                        <span className="min-w-0 truncate text-ink-2" title={item.label}>
                          {item.label}
                          {item.count > 1 && (
                            <span className="text-ink-3" title="how many times it was sent">
                              {' '}
                              ×{item.count}
                            </span>
                          )}
                        </span>
                        <ShareBar part={item.tokens} whole={whole} colour={bar} />
                        <span className={`${NUM}`} title={`about ${exact(item.tokens)} tokens`}>
                          {compactNumber(item.tokens)}
                        </span>
                        <span className={`${NUM} text-ink-3`}>{percent(item.tokens, whole)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** A part's share of the whole, on a faint track. */
function ShareBar({ part, whole, colour }: { part: number; whole: number; colour: string }) {
  const width = whole > 0 ? Math.max((part / whole) * 100, part > 0 ? 1 : 0) : 0;
  return (
    <span aria-hidden className="block h-2 w-full rounded-[4px] bg-line-2">
      <span
        className={`block h-full min-w-[2px] rounded-[4px] ${colour}`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

function Totals({ usage, count }: { usage: Usage; count: string }) {
  const parts = usageParts(usage);
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  const tiles = [
    { label: 'Total', value: parts.total, note: count },
    {
      label: 'Input',
      value: usage.inputTokens,
      note: [
        parts.cached
          ? `${compactNumber(parts.cached)} from cache, ${percent(parts.cached, usage.inputTokens)}`
          : 'none from cache',
        cacheWrite ? `${compactNumber(cacheWrite)} written to cache` : null,
      ]
        .filter(Boolean)
        .join('; '),
    },
    { label: 'Output', value: parts.output, note: null },
  ];
  // One line, wrapping on narrow screens: the breakdown below is what the popup is for.
  return (
    <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-xl border border-line bg-subtle px-3.5 py-2 text-[12.5px]">
      {tiles.map((tile) => (
        <div key={tile.label} className="flex items-baseline gap-1.5">
          <dt className="text-ink-3">{tile.label}</dt>
          <dd
            className="text-[15px] font-bold tabular-nums text-ink"
            title={`${exact(tile.value)} tokens`}
          >
            {compactNumber(tile.value)}
          </dd>
          {tile.note && <dd className="tabular-nums text-ink-3">({tile.note})</dd>}
        </div>
      ))}
    </dl>
  );
}

function Legend() {
  return (
    <ul
      className="-mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-2"
      aria-label="Bar colours"
    >
      {SERIES.map((series) => (
        <li key={series.part} className="flex items-center gap-1.5">
          <span aria-hidden className={`h-2.5 w-2.5 rounded-[3px] ${series.swatch}`} />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

/** A row's tokens as one bar, its length against the table's largest row. */
function UsageBar({ parts, max }: { parts: UsageParts; max: number }) {
  const width = max > 0 ? Math.max((parts.total / max) * 100, parts.total > 0 ? 1 : 0) : 0;
  return (
    <div className="h-2.5 w-full min-w-[96px]" aria-hidden>
      <div className="flex h-full gap-[2px]" style={{ width: `${width}%` }}>
        {SERIES.map(({ part, label, swatch }) =>
          parts[part] > 0 ? (
            <div
              key={part}
              title={`${label}: ${exact(parts[part])} tokens`}
              className={`h-full min-w-[2px] first:rounded-l-[4px] last:rounded-r-[4px] ${swatch}`}
              style={{ flexGrow: parts[part], flexBasis: 0 }}
            />
          ) : null,
        )}
      </div>
    </div>
  );
}

const TH = 'px-2 py-1.5 text-left text-[11.5px] font-medium text-ink-3 first:pl-0 last:pr-0';
const TD = 'px-2 py-2 align-middle first:pl-0 last:pr-0';
const NUM = 'text-right tabular-nums whitespace-nowrap';

/** The numbers beside a bar, exact on hover. */
function UsageCells({ parts }: { parts: UsageParts }) {
  return (
    <>
      <td className={`${TD} ${NUM}`} title={`${exact(parts.cached + parts.freshInput)} tokens`}>
        {compactNumber(parts.cached + parts.freshInput)}
      </td>
      <td className={`${TD} ${NUM} text-ink-3`} title={`${exact(parts.cached)} tokens`}>
        {compactNumber(parts.cached)}
      </td>
      <td className={`${TD} ${NUM}`} title={`${exact(parts.output)} tokens`}>
        {compactNumber(parts.output)}
      </td>
      <td className={`${TD} ${NUM} font-medium text-ink`} title={`${exact(parts.total)} tokens`}>
        {compactNumber(parts.total)}
      </td>
    </>
  );
}

const USAGE_HEADERS = (
  <>
    <th className={`${TH} w-[30%]`}>Tokens</th>
    <th className={`${TH} text-right`}>Input</th>
    <th className={`${TH} text-right`}>Cached</th>
    <th className={`${TH} text-right`}>Output</th>
    <th className={`${TH} text-right`}>Total</th>
  </>
);

/** "Step 2", "Planning", ...: steps are numbered among themselves, as the reply counts them. */
function callLabels(calls: readonly ModelCallUsage[]): string[] {
  let step = 0;
  return calls.map((call) => {
    if (call.kind !== 'step') return CALL_KIND_LABELS[call.kind];
    step += 1;
    return `Step ${step}`;
  });
}

/** Each request a reply sent to the model, in order, and what it cost. */
function CallsTable({
  calls,
  isNested = false,
}: {
  calls: ModelCallUsage[];
  /** inside a message's row of the chat table, which already scrolls sideways */
  isNested?: boolean;
}) {
  const { isOpen, toggle } = useOpenSet();
  if (calls.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-[12.5px] text-ink-3">
        This reply was saved before each request&apos;s tokens were recorded, so only its total is
        known. Replies from now on show each request and what its tokens went to.
      </p>
    );
  }
  const rows = calls.map((call) => usageParts(call));
  const max = Math.max(...rows.map((parts) => parts.total));
  const labels = callLabels(calls);
  const table = (
    <table
      className={`w-full border-collapse text-[12.5px] text-ink-2 ${isNested ? '' : 'min-w-[640px]'}`}
    >
      <thead className="border-b border-line">
        <tr>
          <th className={TH}>#</th>
          <th className={TH}>Request</th>
          <th className={`${TH} text-right`}>Time</th>
          {USAGE_HEADERS}
        </tr>
      </thead>
      <tbody className="divide-y divide-line-2">
        {calls.map((call, index) => {
          const parts = rows[index] ?? usageParts(call);
          const key = String(index);
          const open = isOpen(key);
          const hasParts = call.input.length > 0;
          return (
            <Fragment key={key}>
              <tr>
                <td className={`${TD} tabular-nums text-ink-3`}>{index + 1}</td>
                <td className={`${TD} max-w-[260px]`}>
                  <button
                    type="button"
                    onClick={() => toggle(key)}
                    disabled={!hasParts}
                    aria-expanded={hasParts ? open : undefined}
                    title={
                      hasParts
                        ? `${open ? 'Hide' : 'Show'} what this request's tokens went to`
                        : undefined
                    }
                    className="flex w-full min-w-0 items-start gap-1.5 rounded-md text-left enabled:hover:text-ink disabled:cursor-default"
                  >
                    {hasParts && (
                      <span className="mt-[3px]">
                        <Chevron isOpen={open} />
                      </span>
                    )}
                    <span className="min-w-0">
                      <span className="block font-medium text-ink">{labels[index]}</span>
                      <span
                        className="block truncate text-[11.5px] text-ink-3"
                        title={callDetail(call)}
                      >
                        {callDetail(call)}
                      </span>
                    </span>
                  </button>
                </td>
                <td className={`${TD} ${NUM} text-ink-3`}>
                  {call.durationMs ? callDuration(call.durationMs) : '–'}
                </td>
                <td className={TD}>
                  <UsageBar parts={parts} max={max} />
                </td>
                <UsageCells parts={parts} />
              </tr>
              {open && (
                <tr>
                  <td colSpan={8} className="bg-subtle px-3 py-3">
                    <div className="grid gap-4 lg:grid-cols-2">
                      <Composition
                        title="Input"
                        groups={call.input}
                        bar="bg-usage-input"
                        isCompact
                      />
                      <Composition
                        title="Output"
                        groups={call.output}
                        bar="bg-usage-output"
                        isCompact
                      />
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
  if (isNested) return table;
  return <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">{table}</div>;
}

/** "→ read_file, edit_file · gpt-5": what the response asked for, and the model. */
function callDetail(call: ModelCallUsage): string {
  const reply =
    call.kind !== 'step'
      ? null
      : call.toolCalls.length
        ? `→ ${call.toolCalls.join(', ')}`
        : '→ answer';
  return [reply, call.model].filter(Boolean).join(' · ');
}

/** Each message's reply and its total, folding open to that reply's requests. */
function MessagesTable({ rows }: { rows: MessageUsage[] }) {
  const { isOpen: isRowOpen, toggle } = useOpenSet();
  if (rows.length === 0) {
    return <p className="text-[12.5px] text-ink-3">No finished replies in this chat yet.</p>;
  }
  const parts = rows.map((row) => usageParts(row.usage));
  const max = Math.max(...parts.map((p) => p.total));
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:-mx-5 sm:px-5">
      <table className="w-full min-w-[640px] border-collapse text-[12.5px] text-ink-2">
        <thead className="border-b border-line">
          <tr>
            <th className={TH}>Message</th>
            <th className={`${TH} text-right`}>Steps</th>
            {USAGE_HEADERS}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-2">
          {rows.map((row, index) => {
            const isOpen = isRowOpen(row.key);
            const rowParts = parts[index] ?? usageParts(row.usage);
            return (
              <Fragment key={row.key}>
                <tr>
                  <td className={`${TD} max-w-[280px]`}>
                    <button
                      type="button"
                      onClick={() => toggle(row.key)}
                      aria-expanded={isOpen}
                      className="flex w-full min-w-0 items-center gap-1.5 rounded-md text-left hover:text-ink"
                      title={`${isOpen ? 'Hide' : 'Show'} each request for this reply`}
                    >
                      <Chevron isOpen={isOpen} />
                      <span className="min-w-0 truncate font-medium text-ink">{row.label}</span>
                    </button>
                  </td>
                  <td className={`${TD} ${NUM} text-ink-3`}>{row.steps}</td>
                  <td className={TD}>
                    <UsageBar parts={rowParts} max={max} />
                  </td>
                  <UsageCells parts={rowParts} />
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7} className="bg-subtle px-3 pb-3 pt-1">
                      <CallsTable calls={row.calls} isNested />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
