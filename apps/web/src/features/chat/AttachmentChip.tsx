import { formatBytes, type AttachmentKind } from '@app/shared';
import { Spinner } from '../../components/Spinner';
import { CrossIcon, FileTintIcon, WarnIcon } from '../../lib/icons';
import { fileTint } from '../panel/files/fileTint';

const KIND_LABELS: Record<AttachmentKind, string> = {
  image: 'Image',
  pdf: 'PDF',
  document: 'Document',
  text: 'Text',
  other: 'File',
};

/**
 * One attached file: a thumbnail for images, a tinted file icon otherwise, then its name and
 * size. In the composer it shows the upload and can be removed; in a sent message it opens
 * (downloads) the file.
 */
export function AttachmentChip({
  name,
  size,
  kind,
  previewUrl,
  onOpen,
  status = 'ready',
  error,
  onRemove,
}: {
  name: string;
  size: number;
  kind: AttachmentKind;
  previewUrl?: string | null;
  onOpen?: () => void;
  status?: 'uploading' | 'ready' | 'error';
  error?: string | null;
  onRemove?: () => void;
}) {
  const isError = status === 'error';
  const detail =
    status === 'uploading'
      ? 'Uploading…'
      : isError
        ? (error ?? "Couldn't upload")
        : `${KIND_LABELS[kind]} · ${formatBytes(size)}`;

  const body = (
    <>
      <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-line-2 bg-subtle">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <FileTintIcon size={17} className={fileTint(name).icon} />
        )}
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[12.5px] font-medium text-ink">{name}</span>
        <span
          className={`mt-0.5 flex items-center gap-1 truncate text-[11.5px] ${
            isError ? 'text-danger' : 'text-ink-3'
          }`}
          title={isError ? (error ?? undefined) : undefined}
        >
          {status === 'uploading' && <Spinner size={10} />}
          {isError && <WarnIcon size={11} className="shrink-0" />}
          <span className="truncate">{detail}</span>
        </span>
      </span>
    </>
  );

  const frame = `group relative flex w-[220px] max-w-full items-center gap-2.5 rounded-xl border bg-surface py-1.5 pl-1.5 pr-2.5 ${
    isError ? 'border-danger-line' : 'border-line'
  }`;

  return onOpen ? (
    <button
      type="button"
      onClick={onOpen}
      title={`Download ${name}`}
      className={`${frame} text-left transition-colors hover:border-line-strong hover:bg-surface-2`}
    >
      {body}
    </button>
  ) : (
    <div className={frame}>
      {body}
      {onRemove && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          aria-label={`Remove ${name}`}
          title="Remove"
          className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-line bg-surface text-ink-3 shadow-float transition-colors hover:text-ink"
        >
          <CrossIcon size={9} />
        </button>
      )}
    </div>
  );
}
