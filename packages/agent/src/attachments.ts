// Files the user attached in a chat. The app keeps them (in @app/db, privately in the
// workspace's .nimbrio-ai/uploads/); the agent only reads them through this interface,
// with the attachment tools in tools/attachments.ts.
import { IMAGE_TYPES, fileExtension, type Attachment } from '@app/shared';

export interface AttachmentStore {
  /** null when there is no attachment with that id in this workspace. */
  get(id: string): Promise<Attachment | null>;
  /** The file's bytes. */
  read(id: string): Promise<Buffer>;
}

/** The image as a data URL for the model, or null when it isn't an image a model can take. */
export async function imageDataUrl(store: AttachmentStore, id: string): Promise<string | null> {
  const attachment = await store.get(id);
  if (attachment?.kind !== 'image') return null;
  const type = IMAGE_TYPES[fileExtension(attachment.name)];
  if (!type) return null;
  const bytes = await store.read(id);
  return `data:${type};base64,${bytes.toString('base64')}`;
}
