import { Router } from 'express';
import { IMAGE_TYPES, attachmentUploadSchema, type Attachment } from '@app/shared';
import { asyncHandler } from '../../lib/async-handler.js';
import { param } from '../../lib/params.js';
import { parse } from '../../lib/validate.js';
import type { AttachmentsService } from './attachments.service.js';

/** Shown in the page (thumbnails, the PDF viewer); everything else is only downloaded. */
const INLINE_TYPES = new Set([...Object.values(IMAGE_TYPES), 'application/pdf']);

function contentHeaders({ name, type }: Attachment): Record<string, string> {
  const isInline = INLINE_TYPES.has(type);
  return {
    // Anything else is sent as bytes, so an uploaded HTML or SVG file never runs as a page.
    'Content-Type': isInline ? type : 'application/octet-stream',
    'Content-Disposition': `${isInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
    // An id always names the same bytes.
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
}

export function attachmentsRouter(attachments: AttachmentsService): Router {
  const router = Router();

  /** Upload one file as JSON (`{ name, type, data }`, data in base64). Answers 201 with the Attachment. */
  router.post(
    '/workspaces/:workspaceId/attachments',
    asyncHandler(async (req, res) => {
      const input = parse(attachmentUploadSchema, req.body);
      res.status(201).json({ data: await attachments.upload(param(req, 'workspaceId'), input) });
    }),
  );

  router.get(
    '/workspaces/:workspaceId/attachments/:attachmentId/content',
    asyncHandler(async (req, res) => {
      const { attachment, filePath } = await attachments.file(
        param(req, 'workspaceId'),
        param(req, 'attachmentId'),
      );
      // The file sits under .nimbrio-ai/, so dotfiles must be allowed for this one path.
      await new Promise<void>((resolve, reject) => {
        res.sendFile(
          filePath,
          { headers: contentHeaders(attachment), dotfiles: 'allow' },
          (error) => (error ? reject(error) : resolve()),
        );
      });
    }),
  );

  return router;
}
