// Files users attach in a workspace's chats, kept privately next to its chats:
//
//   <folder>/.nimbrio-ai/uploads/<id>/meta.json   name, type, size, kind, createdAt
//   <folder>/.nimbrio-ai/uploads/<id>/file        the bytes as uploaded
//
// The agent reads them through the AttachmentStore interface (read_attachment, view_image,
// save_attachment); its file tools can't reach .nimbrio-ai/.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ATTACHMENT_LIMITS,
  IMAGE_TYPES,
  attachmentKind,
  fileExtension,
  type Attachment,
} from '@app/shared';
import { APP_DATA_FOLDER, errorCode, writeFileAtomic, type AttachmentStore } from '@app/agent';
import { InputError } from './errors.js';
import { WorkspaceData, attachmentSchema, isUuid } from './workspace-data.js';

/** Types for names browsers often leave untyped. */
const KNOWN_TYPES: Record<string, string> = {
  ...IMAGE_TYPES,
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/** Just the file name: no folders, no control characters, never empty. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean.slice(0, ATTACHMENT_LIMITS.nameLength) || 'file';
}

export class WorkspaceAttachments implements AttachmentStore {
  /** <folder>/.nimbrio-ai/uploads */
  readonly dir: string;

  constructor(readonly folder: string) {
    this.dir = path.join(folder, APP_DATA_FOLDER, 'uploads');
  }

  /** Keep a new upload. Throws InputError when it's empty or too large. */
  async save({ name, type, bytes }: { name: string; type: string; bytes: Buffer }) {
    if (bytes.length === 0) throw new InputError('That file is empty.');
    if (bytes.length > ATTACHMENT_LIMITS.maxBytes) {
      throw new InputError(
        `Files can be at most ${ATTACHMENT_LIMITS.maxBytes / (1024 * 1024)} MB.`,
      );
    }
    await new WorkspaceData(this.folder).ensure(); // the data folder and its .gitignore
    const cleanName = cleanFileName(name);
    const mime = type.trim() || KNOWN_TYPES[fileExtension(cleanName)] || 'application/octet-stream';
    const attachment: Attachment = {
      id: randomUUID(),
      name: cleanName,
      type: mime,
      size: bytes.length,
      kind: attachmentKind(cleanName, mime),
      createdAt: new Date().toISOString(),
    };
    const dir = this.#dir(attachment.id);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, 'file'), bytes, { flag: 'wx' });
    await writeFileAtomic(path.join(dir, 'meta.json'), `${JSON.stringify(attachment, null, 2)}\n`);
    return attachment;
  }

  async get(id: string): Promise<Attachment | null> {
    if (!isUuid(id)) return null;
    try {
      const raw: unknown = JSON.parse(
        await fs.readFile(path.join(this.#dir(id), 'meta.json'), 'utf8'),
      );
      const parsed = attachmentSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return null;
      throw error;
    }
  }

  read(id: string): Promise<Buffer> {
    return fs.readFile(this.filePath(id));
  }

  /** Where the bytes are, for streaming them to the browser. */
  filePath(id: string): string {
    return path.join(this.#dir(id), 'file');
  }

  #dir(id: string): string {
    // Ids become folder names, so only real UUIDs are accepted.
    if (!isUuid(id)) throw new Error(`Not an attachment id: ${id}`);
    return path.join(this.dir, id.toLowerCase());
  }
}
