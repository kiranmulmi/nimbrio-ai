import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { errorMessage } from '../../lib/api';

/** Loading and error states shared by the Memory and Files tabs. */
export function PanelMessage({
  isLoading,
  error,
  onRetry,
}: {
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-4 text-[13px] text-ink-3">
        <Spinner /> Loading…
      </div>
    );
  }
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-3 py-2.5 text-[13px] text-danger"
    >
      {errorMessage(error, "Couldn't load this.")}
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}
