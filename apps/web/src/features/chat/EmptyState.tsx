import { Link } from 'react-router-dom';
import type { Workspace } from '@app/shared';
import { shorten } from '../../lib/format';

const STEPS = [
  {
    title: 'Ask, or let it plan',
    text: 'It answers directly, or writes a plan first when the work has several steps.',
  },
  {
    title: 'Works in your folder',
    text: 'Reads, edits and runs commands in this workspace, asking before each change.',
  },
  {
    title: 'Attach anything',
    text: 'Drop in screenshots, PDFs, Word documents or code for it to read.',
  },
];

/** Decoration beside the headline: a teal orb in a ring, with a small coral moon. */
function Orb() {
  return (
    <div aria-hidden className="relative hidden h-40 w-40 shrink-0 md:block">
      <div className="absolute inset-0 rounded-full border-2 border-dashed border-accent-bg" />
      <div className="absolute inset-5 rounded-full bg-[linear-gradient(145deg,var(--brand-from),var(--brand-mid)_45%,var(--brand-to))] shadow-float" />
      <div className="absolute inset-5 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgb(255_255_255/0.45),transparent_45%)]" />
      <div className="absolute right-1 top-3 h-7 w-7 rounded-full bg-coral shadow-float" />
      <div className="absolute bottom-4 left-0 h-3 w-3 rounded-full bg-accent" />
    </div>
  );
}

/** A new chat: what the agent can do, and the workspace's instructions. */
export function EmptyState({
  workspace,
  showWorkspaceName,
}: {
  workspace: Workspace | null;
  showWorkspaceName: boolean;
}) {
  const name = workspace && showWorkspaceName ? workspace.name : null;
  return (
    <section className="mt-[4vh] w-full">
      <div className="flex items-center justify-between gap-8">
        <div className="min-w-0">
          <span className="tag">New chat</span>
          <h2 className="mt-4 text-[30px] font-extrabold leading-[1.1] text-ink sm:text-[38px]">
            What should we
            <br />
            work on{' '}
            {name ? (
              <>
                in <span className="highlight">{name}</span>?
              </>
            ) : (
              <span className="highlight">today?</span>
            )}
          </h2>
          <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-ink-2">
            Ask anything. For each request the agent decides whether to answer directly or plan the
            work first, then uses tools like web search, page reading and files.
          </p>
        </div>
        <Orb />
      </div>

      <ol className="mt-7 grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step.title} className="panel flex items-start gap-3 p-4">
            <span className="step-number">{String(index + 1).padStart(2, '0')}</span>
            <span className="min-w-0">
              <span className="block text-[14px] font-bold text-ink">{step.title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-3">
                {step.text}
              </span>
            </span>
          </li>
        ))}
      </ol>

      {workspace?.instructions && (
        <Link
          to={`/workspaces/${workspace.id}/settings`}
          className="mt-3 flex max-w-full items-center gap-3 rounded-2xl border border-accent-bg bg-accent-soft px-4 py-3 text-[13px] text-ink-2 transition-colors hover:bg-accent-bg"
        >
          <span className="whitespace-nowrap rounded-full bg-accent px-2.5 py-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-on-accent">
            Instructions on
          </span>
          <span className="min-w-0 truncate">
            {shorten(workspace.instructions.replace(/\s+/g, ' '), 110)}
          </span>
          <span className="ml-auto whitespace-nowrap font-semibold text-accent-2">Edit</span>
        </Link>
      )}
    </section>
  );
}
