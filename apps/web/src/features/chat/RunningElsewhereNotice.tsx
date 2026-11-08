import { Button } from '../../components/Button';
import { RefreshIcon, StopIcon } from '../../lib/icons';
import { StatusLine } from './StatusLine';

/** The opened chat is still running from another tab, so its answer isn't saved yet. */
export function RunningElsewhereNotice({
  onReload,
  onStop,
  isStopping,
}: {
  onReload: () => void;
  onStop: () => void;
  isStopping: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <StatusLine text="The agent is still working on this chat in another tab." />
      <Button size="sm" onClick={onReload}>
        <RefreshIcon /> Reload
      </Button>
      <Button size="sm" variant="danger-outline" onClick={onStop} disabled={isStopping}>
        <StopIcon size={11} /> {isStopping ? 'Stopping…' : 'Stop'}
      </Button>
    </div>
  );
}
