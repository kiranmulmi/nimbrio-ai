import { useEffect, useState } from 'react';
import { formatBytes } from '@app/shared';
import { IconButton } from '../../components/IconButton';
import { Modal } from '../../components/Modal';
import { Spinner } from '../../components/Spinner';
import { ChevronRightIcon, DownloadIcon, ExpandIcon } from '../../lib/icons';
import { useAttachmentUrl } from './useAttachmentUrl';

/** One image the previewer can show: a local URL already in the page, or a sent attachment. */
export interface PreviewImage {
  key: string;
  name: string;
  size: number;
  /** shown as is (an image in the message box, before it's sent) */
  url?: string | null;
  /** a sent attachment, fetched with the sign-in */
  attachmentId?: string;
}

/**
 * Pasted and attached images, large: fitted to the window, or at their actual size (click the
 * image or the button) to read the details. Arrows (and ← →) step through the others sent with
 * it; Download saves the one showing.
 */
export function ImagePreview({
  images,
  startAt,
  workspaceId,
  onClose,
}: {
  images: readonly PreviewImage[];
  startAt: number;
  workspaceId: string;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(() => Math.min(Math.max(startAt, 0), images.length - 1));
  const [isActualSize, setIsActualSize] = useState(false);
  const image = images[index];
  const remote = useAttachmentUrl(workspaceId, image?.url ? null : (image?.attachmentId ?? null));
  const url = image?.url ?? remote.url;
  const [dimensions, setDimensions] = useState<{ key: string; text: string } | null>(null);
  const hasSeveral = images.length > 1;

  useEffect(() => {
    if (!hasSeveral) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      setIndex((current) => (current + step + images.length) % images.length);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [hasSeveral, images.length]);

  if (!image) return null;

  function step(by: number) {
    setIndex((current) => (current + by + images.length) % images.length);
  }

  function download() {
    if (!url || !image) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = image.name;
    link.click();
  }

  const details = [
    formatBytes(image.size),
    dimensions?.key === image.key ? dimensions.text : null,
    hasSeveral ? `${index + 1} of ${images.length}` : null,
  ].filter(Boolean);

  return (
    <Modal
      title={image.name}
      titleFont="sans"
      size="wide"
      onClose={onClose}
      actions={
        <>
          {hasSeveral && (
            <>
              <IconButton onClick={() => step(-1)} aria-label="Previous image" title="Previous (←)">
                <ChevronRightIcon size={13} className="rotate-180" />
              </IconButton>
              <IconButton onClick={() => step(1)} aria-label="Next image" title="Next (→)">
                <ChevronRightIcon size={13} />
              </IconButton>
            </>
          )}
          <IconButton
            onClick={() => setIsActualSize((current) => !current)}
            aria-pressed={isActualSize}
            aria-label={isActualSize ? 'Fit to window' : 'Actual size'}
            title={isActualSize ? 'Fit to window' : 'Actual size'}
            className={isActualSize ? 'bg-surface-2 text-ink' : ''}
          >
            <ExpandIcon />
          </IconButton>
          <IconButton onClick={download} disabled={!url} aria-label="Download" title="Download">
            <DownloadIcon />
          </IconButton>
        </>
      }
      footer={<p className="text-[12.5px] text-ink-3">{details.join(' · ')}</p>}
    >
      <div
        className={`flex bg-subtle p-4 ${isActualSize ? 'min-h-full min-w-full w-max' : 'h-full w-full'}`}
      >
        {url ? (
          <img
            key={image.key}
            src={url}
            alt={image.name}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              setDimensions({ key: image.key, text: `${naturalWidth} × ${naturalHeight}` });
            }}
            onClick={() => setIsActualSize((current) => !current)}
            className={`m-auto rounded-lg shadow-card ${
              isActualSize
                ? 'max-w-none cursor-zoom-out'
                : 'max-h-full max-w-full cursor-zoom-in object-contain'
            }`}
          />
        ) : (
          <p className="m-auto flex items-center gap-2 text-[13px] text-ink-3">
            {remote.isMissing ? (
              `${image.name} can't be shown.`
            ) : (
              <>
                <Spinner size={14} /> Loading…
              </>
            )}
          </p>
        )}
      </div>
    </Modal>
  );
}
