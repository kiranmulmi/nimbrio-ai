import { useEffect, useState } from 'react';
import { fetchAttachment } from './api';

/**
 * A sent attachment as a blob URL the page can show, fetched with the sign-in (an `<img src>`
 * can't carry the access token) and let go when the component goes. Null while it loads, or
 * when there is nothing to load (`attachmentId` null).
 */
export function useAttachmentUrl(
  workspaceId: string,
  attachmentId: string | null,
): { url: string | null; isMissing: boolean } {
  const [url, setUrl] = useState<string | null>(null);
  const [isMissing, setIsMissing] = useState(false);

  useEffect(() => {
    setUrl(null);
    setIsMissing(false);
    if (!attachmentId) return;
    let isCurrent = true;
    let objectUrl: string | null = null;
    fetchAttachment(workspaceId, attachmentId).then(
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
  }, [workspaceId, attachmentId]);

  return { url, isMissing };
}
