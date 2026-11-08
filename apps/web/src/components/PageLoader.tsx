import { Spinner } from './Spinner';

/** Fills the page body while its first request is still out. */
export function PageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex w-full items-center justify-center gap-2 px-8 py-20 text-[14px] text-ink-3">
      <Spinner size={16} />
      {label}
    </div>
  );
}
