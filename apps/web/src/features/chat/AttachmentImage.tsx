import type { Attachment } from '@app/shared';
import { useAttachmentUrl } from './useAttachmentUrl';

/**
 * A sent image as a thumbnail that opens the previewer. It's fetched with the sign-in and
 * shown from a blob URL, since an `<img src>` can't carry the access token.
 */
export function AttachmentImage({
  workspaceId,
  image,
  onOpen,
}: {
  workspaceId: string;
  image: Attachment;
  onOpen: () => void;
}) {
  const { url, isMissing } = useAttachmentUrl(workspaceId, image.id);

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
    <button
      type="button"
      onClick={onOpen}
      title={`Preview ${image.name}`}
      aria-label={`Preview ${image.name}`}
      className={`${frame} cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      <img src={url} alt={image.name} className="h-28 w-auto max-w-[240px] object-cover sm:h-36" />
    </button>
  );
}
