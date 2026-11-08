import fs from 'node:fs/promises';
import {
  ATTACHMENT_LIMITS,
  type Attachment,
  type AttachmentUpload,
  type Workspace,
} from '@app/shared';
import type { AppContext } from '../../context.js';
import { NotFoundError, PayloadTooLargeError, ValidationError } from '../../lib/errors.js';
import type { WorkspacesService } from '../workspaces/workspaces.service.js';

/** Base64 of the largest file, plus room for the rest of the JSON. */
export const UPLOAD_BODY_LIMIT = `${Math.ceil((ATTACHMENT_LIMITS.maxBytes * 4) / 3 / (1024 * 1024)) + 1}mb`;

export function createAttachmentsService({ store }: AppContext, workspaces: WorkspacesService) {
  return {
    async upload(
      workspaceId: string,
      { name, type = '', data }: AttachmentUpload,
    ): Promise<Attachment> {
      const workspace = await workspaces.require(workspaceId);
      // Checked before decoding, so an oversized upload costs no memory.
      if (Math.floor((data.length * 3) / 4) > ATTACHMENT_LIMITS.maxBytes + 2) {
        throw new PayloadTooLargeError(
          `Files can be at most ${ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)} MB.`,
        );
      }
      return store.attachments(workspace).save({ name, type, bytes: Buffer.from(data, 'base64') });
    },

    /** An attachment and where its bytes are, to send to the browser. */
    async file(workspaceId: string, attachmentId: string) {
      const workspace = await workspaces.require(workspaceId);
      const attachments = store.attachments(workspace);
      const attachment = await attachments.get(attachmentId);
      const filePath = attachment ? attachments.filePath(attachment.id) : null;
      if (!attachment || !filePath || !(await fs.stat(filePath).catch(() => null))) {
        throw new NotFoundError('That attachment no longer exists.');
      }
      return { attachment, filePath };
    },

    /** The attachments a run refers to, in order. Throws before the run starts if one is gone. */
    async requireAll(workspace: Workspace, ids: readonly string[]): Promise<Attachment[]> {
      const attachments = store.attachments(workspace);
      const found = await Promise.all([...new Set(ids)].map((id) => attachments.get(id)));
      if (found.some((attachment) => attachment === null)) {
        throw new ValidationError('An attached file is no longer there. Attach it again.');
      }
      return found.filter((attachment): attachment is Attachment => attachment !== null);
    },
  };
}

export type AttachmentsService = ReturnType<typeof createAttachmentsService>;
