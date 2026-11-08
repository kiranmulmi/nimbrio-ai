// The files the user attached in the chat: read their text (PDF, Word, plain text), look at
// images, or copy one into the workspace. Attachments live outside the workspace folder, so
// the file tools can't reach them; these tools take the id from the user's message.
import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';
import { formatBytes, type Attachment } from '@app/shared';
import { assertCanChange } from '../guardrails.js';
import { defineTool, type ToolContext } from './define.js';
import { locate } from './files/walk.js';

/** Kept under the tool output limit, so long text is cut at a page or line, with a note. */
const MAX_CHARS = 18_000;

async function findAttachment(ctx: ToolContext, id: string): Promise<Attachment> {
  const attachment = await ctx.attachments?.get(id.trim());
  if (!attachment) {
    throw new Error(
      `There is no attachment with id "${id}". The attached files and their ids are listed in the user's message.`,
    );
  }
  return attachment;
}

/** As many items from `first` (1-based) as fit, and where to continue. */
function takeFitting(items: readonly string[], first: number): { shown: string[]; last: number } {
  const shown: string[] = [];
  let chars = 0;
  for (let i = first - 1; i < items.length; i += 1) {
    const item = items[i] ?? '';
    if (chars + item.length > MAX_CHARS && shown.length > 0) break;
    shown.push(item.length > MAX_CHARS ? `${item.slice(0, MAX_CHARS)}…` : item);
    chars += item.length + 1;
  }
  return { shown, last: first + shown.length - 1 };
}

function readLines(attachment: Attachment, text: string, startLine = 1): string {
  const lines = text.split('\n');
  const first = Math.max(startLine, 1);
  if (first > lines.length) {
    throw new Error(
      `"${attachment.name}" has ${lines.length} lines; start_line ${first} is past the end.`,
    );
  }
  const { shown, last } = takeFitting(lines, first);
  if (first === 1 && last === lines.length) return shown.join('\n');
  const more = last < lines.length ? ` Continue with start_line ${last + 1}.` : '';
  return `[${attachment.name}: lines ${first}-${last} of ${lines.length}.${more}]\n${shown.join('\n')}`;
}

async function readPdf(attachment: Attachment, bytes: Buffer, startPage = 1): Promise<string> {
  const { totalPages, text: pages } = await extractText(new Uint8Array(bytes), {
    mergePages: false,
  });
  if (!pages.some((page) => page.trim())) {
    return `"${attachment.name}" (${totalPages} pages) has no text layer, so it is probably scanned. Its text can't be read; ask the user for a text version or a screenshot of the pages that matter.`;
  }
  const first = Math.max(startPage, 1);
  if (first > totalPages) {
    throw new Error(
      `"${attachment.name}" has ${totalPages} pages; start_page ${first} is past the end.`,
    );
  }
  const numbered = pages.map((page, index) => `--- Page ${index + 1} ---\n${page.trim()}`);
  const { shown, last } = takeFitting(numbered, first);
  const more = last < totalPages ? ` Continue with start_page ${last + 1}.` : '';
  return `[${attachment.name}: pages ${first}-${last} of ${totalPages}.${more}]\n${shown.join('\n\n')}`;
}

export const readAttachment = defineTool<{ id: string; start_page?: number; start_line?: number }>({
  name: 'read_attachment',
  description:
    'Read the text of a file the user attached to the chat: a PDF, a Word document (.docx) or a text file (code, CSV, JSON, Markdown, ...). Call this whenever the user refers to an attached file. PDFs come back page by page (continue with start_page), other files line by line (continue with start_line). For images use view_image.',
  properties: {
    id: { type: 'string', description: "The attachment's id, from the user's message." },
    start_page: { type: 'integer', description: 'PDFs: first page to read (1-based). Default 1.' },
    start_line: {
      type: 'integer',
      description: 'Other files: first line to read (1-based). Default 1.',
    },
  },
  optional: ['start_page', 'start_line'],
  async run({ id, start_page: startPage, start_line: startLine }, ctx) {
    const attachment = await findAttachment(ctx, id);
    if (attachment.kind === 'image') {
      throw new Error(`"${attachment.name}" is an image; look at it with view_image instead.`);
    }
    if (attachment.kind === 'other') {
      throw new Error(
        `"${attachment.name}" (${attachment.type || 'unknown type'}) can't be read as text. save_attachment can copy it into the workspace if a tool there can open it.`,
      );
    }
    const bytes = await ctx.attachments?.read(attachment.id);
    if (!bytes) throw new Error(`"${attachment.name}" can't be read.`);
    if (attachment.kind === 'pdf') return readPdf(attachment, bytes, startPage);
    if (attachment.kind === 'document') {
      const { value } = await mammoth.extractRawText({ buffer: bytes });
      if (!value.trim()) return `"${attachment.name}" has no text.`;
      return readLines(attachment, value.replace(/\n{3,}/g, '\n\n').trim(), startLine);
    }
    return readLines(attachment, bytes.toString('utf8'), startLine);
  },
});

export const viewImage = defineTool<{ id: string }>({
  name: 'view_image',
  description:
    'Look at an image the user attached to the chat (PNG, JPEG, GIF or WebP): a screenshot, a photo, a diagram, a design. Call this before answering anything about the image. The image is shown to you in the next message. Needs a model that can see images.',
  properties: {
    id: { type: 'string', description: "The attachment's id, from the user's message." },
  },
  async run({ id }, ctx) {
    const attachment = await findAttachment(ctx, id);
    if (attachment.kind !== 'image') {
      throw new Error(
        `"${attachment.name}" is not an image; read it with read_attachment instead.`,
      );
    }
    ctx.showImage(attachment.id);
    return `"${attachment.name}" (${formatBytes(attachment.size)}) is shown to you in the next message.`;
  },
});

export const saveAttachment = defineTool<{ id: string; path: string }>({
  name: 'save_attachment',
  description:
    'Copy a file the user attached into the workspace folder, e.g. to put an uploaded logo into a website or a data file next to the script that reads it. Call this only when the file should become part of the project. Never overwrites: it fails if the path exists.',
  properties: {
    id: { type: 'string', description: "The attachment's id, from the user's message." },
    path: {
      type: 'string',
      description: 'Where to save it, relative to the workspace folder, with the file name.',
    },
  },
  needsApproval: true,
  async run({ id, path: requested }, ctx) {
    const attachment = await findAttachment(ctx, id);
    const destination = await locate(ctx, requested);
    await assertCanChange(destination.root, destination.target);
    if (await fs.stat(destination.target).catch(() => null)) {
      throw new Error(`"${destination.shown}" already exists. Pick another path.`);
    }
    const bytes = await ctx.attachments?.read(attachment.id);
    if (!bytes) throw new Error(`"${attachment.name}" can't be read.`);
    await fs.mkdir(path.dirname(destination.target), { recursive: true });
    await fs.writeFile(destination.target, bytes, { flag: 'wx' });
    return `Saved "${attachment.name}" (${formatBytes(attachment.size)}) to ${destination.shown}.`;
  },
});
