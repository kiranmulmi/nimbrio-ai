import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Spinner } from '../../components/Spinner';
import { CheckIcon, CrossIcon, ShieldIcon } from '../../lib/icons';
import type { ApprovalItem } from './conversation';
import { ToolInput } from './ToolInput';

/** The agent asks before it runs a tool that changes something, e.g. writing a file or running a command. */
export function ApprovalCard({
  item,
  onDecide,
}: {
  item: ApprovalItem;
  onDecide: (approvalId: string, allow: boolean) => void;
}) {
  const isOpen = item.state === 'pending' || item.state === 'sending';
  return (
    <div
      className={`panel flex flex-col gap-3 rounded-l-none border-l-[3px] px-4 py-3.5 ${
        isOpen
          ? 'border-l-warn-line'
          : item.state === 'allowed'
            ? 'border-l-success-line'
            : 'border-l-danger-line'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldIcon size={15} className={`shrink-0 ${isOpen ? 'text-warn' : 'text-ink-3'}`} />
          <span className="font-medium text-ink">
            The agent wants to run <span className="font-mono text-[13px]">{item.tool}</span>
          </span>
        </div>
        {isOpen ? (
          <Badge tone="yellow">Needs your approval</Badge>
        ) : item.state === 'allowed' ? (
          <Badge tone="green" icon={<CheckIcon size={11} />}>
            Allowed
          </Badge>
        ) : (
          <Badge tone="red" icon={<CrossIcon size={11} />}>
            Denied
          </Badge>
        )}
      </div>
      <ToolInput tool={item.tool} input={item.input} />
      {isOpen && (
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            disabled={item.state === 'sending'}
            onClick={() => onDecide(item.approvalId, true)}
          >
            <CheckIcon /> Allow
          </Button>
          <Button
            variant="danger-outline"
            disabled={item.state === 'sending'}
            onClick={() => onDecide(item.approvalId, false)}
          >
            Deny
          </Button>
          {item.state === 'sending' && <Spinner size={13} label="Sending" />}
        </div>
      )}
      {item.error && (
        <div role="alert" className="text-[13px] text-danger">
          {item.error}
        </div>
      )}
    </div>
  );
}
