/** What the agent is doing right now, e.g. "Reading en.wikipedia.org". */
export function ActivityLine({ text }: { text: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-[12px] text-accent">
      <span aria-hidden className="inline-flex shrink-0 gap-[3px]">
        {[0, 150, 300].map((delay) => (
          <i
            key={delay}
            style={{ animationDelay: `${delay}ms` }}
            className="h-1 w-1 animate-dot-bounce rounded-full bg-current motion-reduce:animate-none"
          />
        ))}
      </span>
      <span className="truncate">{text}</span>
    </span>
  );
}
