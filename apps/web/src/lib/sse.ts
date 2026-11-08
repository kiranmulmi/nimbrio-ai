import type { StreamEvent } from '@app/shared';

/** The `data:` payload of one server-sent event frame, or null for a frame without one. */
function frameData(frame: string): string | null {
  const lines = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return lines.length ? lines.join('\n') : null;
}

/**
 * Reads a `text/event-stream` body and yields the data of each event as it arrives.
 * Frames end with a blank line; `event:`, `id:` and `:` comment lines are ignored.
 */
export async function* readEventData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const data = frameData(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (data !== null) yield data;
        end = buffer.indexOf('\n\n');
      }
    }
    const tail = frameData((buffer + decoder.decode()).replace(/\r\n/g, '\n'));
    if (tail !== null) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Parses one event of `POST /v1/runs`; anything that isn't a typed JSON object is dropped. */
export function parseStreamEvent(data: string): StreamEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || !('type' in value)) return null;
  return typeof value.type === 'string' ? (value as StreamEvent) : null;
}
