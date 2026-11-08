import { z } from 'zod';

/**
 * A file the user attached in a chat. It is kept privately in the workspace's
 * `.nimbrio-ai/uploads/` (never in the project folder itself); the agent reads it with
 * its attachment tools (read_attachment, view_image, save_attachment).
 */
export interface Attachment {
  id: string;
  /** The file name as uploaded, without any folder. */
  name: string;
  /** MIME type as the browser reported it, or a guess from the name. */
  type: string;
  size: number;
  kind: AttachmentKind;
  createdAt: string;
}

/** What the agent can do with it: look at it, read its text, or only copy it. */
export const ATTACHMENT_KINDS = ['image', 'pdf', 'document', 'text', 'other'] as const;
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number];

export const ATTACHMENT_LIMITS = {
  /** Per file, after base64 decoding. */
  maxBytes: 15 * 1024 * 1024,
  perMessage: 10,
  nameLength: 200,
} as const;

/** Images every vision model accepts. Others (SVG, HEIC, TIFF) are kept as plain files. */
export const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const DOCUMENT_EXTENSIONS = new Set(['docx']);

/** Files read as plain text: code, data and notes. */
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'swift',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'sql',
  'log',
  'ini',
  'env',
  'conf',
  'svg',
]);

/** "1.2 MB" */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** Decided from the name first (browsers often report an empty or generic type). */
export function attachmentKind(name: string, type: string): AttachmentKind {
  const extension = fileExtension(name);
  if (IMAGE_TYPES[extension]) return 'image';
  if (extension === 'pdf' || type === 'application/pdf') return 'pdf';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  if (TEXT_EXTENSIONS.has(extension) || type.startsWith('text/')) return 'text';
  return 'other';
}

export const attachmentUploadSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'The file needs a name.')
    .max(ATTACHMENT_LIMITS.nameLength, 'That file name is too long.'),
  type: z.string().max(200).default(''),
  /** The file's bytes, base64-encoded (the API only accepts JSON). */
  data: z.string().regex(/^[A-Za-z0-9+/]*={0,2}$/, 'The file data must be base64.'),
});

export type AttachmentUpload = z.input<typeof attachmentUploadSchema>;
