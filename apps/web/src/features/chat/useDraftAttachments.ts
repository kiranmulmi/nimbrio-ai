import { useCallback, useEffect, useRef, useState } from 'react';
import { ATTACHMENT_LIMITS, attachmentKind, formatBytes, type Attachment } from '@app/shared';
import { errorMessage } from '../../lib/api';
import { uploadAttachment } from './api';

/** A file picked for the next message: uploading, ready to send, or failed. */
export interface DraftAttachment {
  key: string;
  name: string;
  size: number;
  /** A local preview of an image, until the message is sent. */
  previewUrl: string | null;
  status: 'uploading' | 'ready' | 'error';
  attachment: Attachment | null;
  error: string | null;
}

let nextKey = 0;

/**
 * The files attached to the message being written. Each one uploads as soon as it is
 * picked, so sending only passes ids.
 */
export function useDraftAttachments(workspaceId: string) {
  const [drafts, setDrafts] = useState<DraftAttachment[]>([]);
  const previews = useRef(new Set<string>());

  const update = (key: string, patch: Partial<DraftAttachment>) =>
    setDrafts((current) => current.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const release = (draft: DraftAttachment) => {
    if (!draft.previewUrl) return;
    URL.revokeObjectURL(draft.previewUrl);
    previews.current.delete(draft.previewUrl);
  };

  // How many files are attached right now, read when more are added.
  const count = useRef(0);
  useEffect(() => {
    count.current = drafts.length;
  }, [drafts.length]);

  const add = useCallback(
    (files: Iterable<File>) => {
      const room = Math.max(ATTACHMENT_LIMITS.perMessage - count.current, 0);
      const picked = [...files].slice(0, room);
      count.current += picked.length;
      const added = picked.map((file) => {
        const isImage = attachmentKind(file.name, file.type) === 'image';
        const previewUrl = isImage ? URL.createObjectURL(file) : null;
        if (previewUrl) previews.current.add(previewUrl);
        const isTooBig = file.size > ATTACHMENT_LIMITS.maxBytes;
        const draft: DraftAttachment = {
          key: `a${(nextKey += 1)}`,
          name: file.name,
          size: file.size,
          previewUrl,
          status: isTooBig ? 'error' : 'uploading',
          attachment: null,
          error: isTooBig
            ? `Too large: files can be at most ${formatBytes(ATTACHMENT_LIMITS.maxBytes)}.`
            : null,
        };
        return { draft, file, isTooBig };
      });
      setDrafts((current) => [...current, ...added.map(({ draft }) => draft)]);
      for (const { draft, file, isTooBig } of added) {
        if (isTooBig) continue;
        uploadAttachment(workspaceId, file)
          .then((attachment) => update(draft.key, { status: 'ready', attachment }))
          .catch((cause: unknown) =>
            update(draft.key, { status: 'error', error: errorMessage(cause, "Couldn't upload.") }),
          );
      }
    },
    [workspaceId],
  );

  const remove = useCallback((key: string) => {
    setDrafts((current) => {
      const draft = current.find((d) => d.key === key);
      if (draft) release(draft);
      return current.filter((d) => d.key !== key);
    });
  }, []);

  /** After sending: the message keeps its attachments, the box starts empty. */
  const clear = useCallback(() => {
    setDrafts((current) => {
      current.forEach(release);
      return [];
    });
  }, []);

  // Another workspace: its uploads live elsewhere, so start over.
  useEffect(() => clear, [workspaceId, clear]);

  useEffect(() => {
    const urls = previews.current;
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const ready = drafts.flatMap((d) => (d.status === 'ready' && d.attachment ? [d.attachment] : []));
  const isUploading = drafts.some((d) => d.status === 'uploading');
  const isFull = drafts.length >= ATTACHMENT_LIMITS.perMessage;
  return { drafts, ready, isUploading, isFull, add, remove, clear };
}
