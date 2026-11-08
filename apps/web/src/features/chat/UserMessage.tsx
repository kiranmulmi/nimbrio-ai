import type { Attachment } from '@app/shared';
import { CopyButton } from '../../components/CopyButton';
import { attachmentUrl } from './api';
import { AttachmentChip } from './AttachmentChip';
import { MessageTime } from './MessageTime';
import { SkillChip } from './SkillChip';

/**
 * What the user sent: attached images as thumbnails, other files as chips, then the text,
 * with a copy button (shown on hover or focus, always on touch screens) and the time it was
 * sent under it.
 */
export function UserMessage({
  text,
  attachments,
  skills,
  sentAt,
  isSteer = false,
  workspaceId,
}: {
  text: string;
  attachments: Attachment[];
  /** names of the skills picked for it */
  skills: string[];
  /** when it was sent (ISO), null if unknown */
  sentAt: string | null;
  /** Sent while the agent worked, and read by it before its next step. */
  isSteer?: boolean;
  workspaceId: string;
}) {
  const images = attachments.filter((a) => a.kind === 'image');
  const others = attachments.filter((a) => a.kind !== 'image');
  return (
    <div className="group/message flex flex-col items-end gap-1.5">
      {images.length > 0 && (
        <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5 md:max-w-[80%]">
          {images.map((image) => {
            const url = attachmentUrl(workspaceId, image.id);
            return (
              <a
                key={image.id}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                title={image.name}
                className="block overflow-hidden rounded-2xl border border-line bg-subtle shadow-card transition-opacity hover:opacity-90"
              >
                <img
                  src={url}
                  alt={image.name}
                  loading="lazy"
                  className="h-28 w-auto max-w-[240px] object-cover sm:h-36"
                />
              </a>
            );
          })}
        </div>
      )}
      {skills.length > 0 && (
        <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5 md:max-w-[80%]">
          {skills.map((name) => (
            <SkillChip key={name} name={name} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex max-w-[92%] flex-wrap justify-end gap-1.5 md:max-w-[80%]">
          {others.map((file) => (
            <AttachmentChip
              key={file.id}
              name={file.name}
              size={file.size}
              kind={file.kind}
              href={attachmentUrl(workspaceId, file.id)}
            />
          ))}
        </div>
      )}
      {text && (
        <div className="max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-[var(--md-line)] bg-[var(--md-fill)] px-4 py-2.5 text-ink [overflow-wrap:anywhere] md:max-w-[80%]">
          {text}
        </div>
      )}
      {(text || sentAt || isSteer) && (
        <div className="-mt-1 flex items-center gap-1 text-[12px] text-ink-3">
          {text && (
            <CopyButton
              text={text}
              label="Copy message"
              className="opacity-0 focus-visible:opacity-100 group-hover/message:opacity-100 [@media(hover:none)]:opacity-100"
            />
          )}
          {isSteer && <span>Sent while the agent worked ·</span>}
          <MessageTime iso={sentAt} />
        </div>
      )}
    </div>
  );
}
