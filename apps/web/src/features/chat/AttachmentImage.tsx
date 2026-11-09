import { useEffect, useState } from 'react';
import type { Attachment } from '@app/shared';
import { fetchAttachment } from './api';

/**
 * A sent image as a thumbnail that opens full size in a new tab. It's fetched with the
 * sign-in and shown from a blob URL, since an `<img src>` can't carry the access token.
 */
export function AttachmentImage({
  workspaceId,
  image,
}: {
  workspaceId: string;
  image: Attachment;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    let objectUrl: string | null = null;
    setUrl(null);
    setIsMissing(false);
    fetchAttachment(workspaceId, image.id).then(
      (blob) => {
        if (!isCurrent) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      },
      () => isCurrent && setIsMissing(true),
    );
    return () => {
      isCurrent = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workspaceId, image.id]);

  const frame =
    'block overflow-hidden rounded-2xl border border-line bg-subtle shadow-card transition-opacity hover:opacity-90';
  if (!url) {
    return (
      <span
        title={isMissing ? `${image.name} can't be shown` : image.name}
        className={`${frame} grid h-28 w-36 place-items-center px-2 text-center text-[12px] text-ink-3 sm:h-36`}
      >
        {isMissing ? image.name : ''}
      </span>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={image.name} className={frame}>
      <img src={url} alt={image.name} className="h-28 w-auto max-w-[240px] object-cover sm:h-36" />
    </a>
  );
}
