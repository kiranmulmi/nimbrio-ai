// Protobuf wire format and Connect-RPC framing for Cursor's private API, written by hand
// (there is no published schema). Field numbers come from OmniRoute's reverse-engineered
// codec (open-sse/utils/cursorAgentProtobuf), which was read off the Cursor CLI's own schema.
import { gunzipSync, gzipSync } from 'node:zlib';

const WT_VARINT = 0;
const WT_FIXED64 = 1;
const WT_LEN = 2;
const WT_FIXED32 = 5;

export type Field =
  | { fieldNumber: number; wireType: 0; varint: bigint }
  | { fieldNumber: number; wireType: 2; bytes: Buffer };

function encodeVarint(value: number | bigint): Buffer {
  let rest = BigInt(value);
  const bytes: number[] = [];
  while (rest > 0x7fn) {
    bytes.push(Number(rest & 0x7fn) | 0x80);
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return Buffer.from(bytes);
}

const tag = (fieldNumber: number, wireType: number) => encodeVarint((fieldNumber << 3) | wireType);

export function bytesField(fieldNumber: number, value: Buffer): Buffer {
  return Buffer.concat([tag(fieldNumber, WT_LEN), encodeVarint(value.length), value]);
}

export const stringField = (fieldNumber: number, value: string): Buffer =>
  bytesField(fieldNumber, Buffer.from(value, 'utf8'));

/** A nested message: its parts, concatenated, as one length-delimited field. */
export const messageField = (fieldNumber: number, parts: Buffer[]): Buffer =>
  bytesField(fieldNumber, Buffer.concat(parts));

export const uintField = (fieldNumber: number, value: number): Buffer =>
  Buffer.concat([tag(fieldNumber, WT_VARINT), encodeVarint(value)]);

export const boolField = (fieldNumber: number, value: boolean): Buffer =>
  uintField(fieldNumber, value ? 1 : 0);

function doubleField(fieldNumber: number, value: number): Buffer {
  const bytes = Buffer.alloc(8);
  bytes.writeDoubleLE(value, 0);
  return Buffer.concat([tag(fieldNumber, WT_FIXED64), bytes]);
}

function decodeVarint(buf: Buffer, offset: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (let pos = offset; pos < buf.length; pos++) {
    const byte = buf.readUInt8(pos);
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return [result, pos + 1];
    shift += 7n;
  }
  throw new Error('Cursor sent a truncated number.');
}

/** A length that fits in what's left of the buffer, or an error (never a silent clamp). */
function checkedLength(length: bigint, pos: number, buf: Buffer): number {
  if (length < 0n || length > BigInt(buf.length - pos)) {
    throw new Error('Cursor sent a field longer than its message.');
  }
  return Number(length);
}

/** The top-level fields of one message. Fixed-width fields are skipped; nothing here uses them. */
export function decodeFields(buf: Buffer): Field[] {
  const fields: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = decodeVarint(buf, pos);
    pos = afterKey;
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    if (wireType === WT_VARINT) {
      const [varint, next] = decodeVarint(buf, pos);
      fields.push({ fieldNumber, wireType: 0, varint });
      pos = next;
    } else if (wireType === WT_LEN) {
      const [length, start] = decodeVarint(buf, pos);
      const end = start + checkedLength(length, start, buf);
      fields.push({ fieldNumber, wireType: 2, bytes: buf.subarray(start, end) });
      pos = end;
    } else if (wireType === WT_FIXED64) {
      pos += 8;
    } else if (wireType === WT_FIXED32) {
      pos += 4;
    } else {
      throw new Error(`Cursor sent an unknown wire type ${wireType}.`);
    }
  }
  return fields;
}

/** The first length-delimited field with this number. */
export function bytesOf(fields: Field[], fieldNumber: number): Buffer | null {
  const field = fields.find((f) => f.fieldNumber === fieldNumber && f.wireType === WT_LEN);
  return field?.wireType === WT_LEN ? field.bytes : null;
}

export const stringOf = (fields: Field[], fieldNumber: number): string =>
  bytesOf(fields, fieldNumber)?.toString('utf8') ?? '';

/** The first varint field with this number, as a safe integer (0 when absent). */
export function numberOf(fields: Field[], fieldNumber: number): number {
  const field = fields.find((f) => f.fieldNumber === fieldNumber && f.wireType === WT_VARINT);
  if (field?.wireType !== WT_VARINT) return 0;
  return field.varint <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(field.varint) : 0;
}

// ---------- google.protobuf.Value (tool schemas and tool arguments) ----------

const VALUE_NULL = 1;
const VALUE_NUMBER = 2;
const VALUE_STRING = 3;
const VALUE_BOOL = 4;
const VALUE_STRUCT = 5;
const VALUE_LIST = 6;
const STRUCT_FIELDS = 1;
const LIST_VALUES = 1;
const MAP_KEY = 1;
const MAP_VALUE = 2;

/** A JSON value as the body of a google.protobuf.Value message. */
export function encodeValue(value: unknown): Buffer {
  if (typeof value === 'number') return doubleField(VALUE_NUMBER, value);
  if (typeof value === 'string') return stringField(VALUE_STRING, value);
  if (typeof value === 'boolean') return boolField(VALUE_BOOL, value);
  if (Array.isArray(value)) {
    return messageField(
      VALUE_LIST,
      value.map((item) => messageField(LIST_VALUES, [encodeValue(item)])),
    );
  }
  if (value !== null && typeof value === 'object') {
    return messageField(
      VALUE_STRUCT,
      Object.entries(value).map(([key, item]) =>
        messageField(STRUCT_FIELDS, [
          stringField(MAP_KEY, key),
          messageField(MAP_VALUE, [encodeValue(item)]),
        ]),
      ),
    );
  }
  return uintField(VALUE_NULL, 0);
}

/** A google.protobuf.Value message back to JSON. */
export function decodeValue(buf: Buffer): unknown {
  let pos = 0;
  while (pos < buf.length) {
    const [key, afterKey] = decodeVarint(buf, pos);
    const fieldNumber = Number(key >> 3n);
    const wireType = Number(key & 7n);
    pos = afterKey;
    if (fieldNumber === VALUE_NUMBER && wireType === WT_FIXED64 && pos + 8 <= buf.length) {
      return buf.readDoubleLE(pos);
    }
    if (fieldNumber === VALUE_BOOL && wireType === WT_VARINT)
      return decodeVarint(buf, pos)[0] !== 0n;
    if (fieldNumber === VALUE_NULL) return null;
    if (wireType === WT_LEN) {
      const [length, start] = decodeVarint(buf, pos);
      const payload = buf.subarray(start, start + checkedLength(length, start, buf));
      if (fieldNumber === VALUE_STRING) return payload.toString('utf8');
      if (fieldNumber === VALUE_STRUCT) return decodeStruct(payload);
      if (fieldNumber === VALUE_LIST) {
        return decodeFields(payload)
          .filter((f) => f.fieldNumber === LIST_VALUES && f.wireType === WT_LEN)
          .map((f) => (f.wireType === WT_LEN ? decodeValue(f.bytes) : null));
      }
      pos = start + payload.length;
    } else if (wireType === WT_VARINT) {
      pos = decodeVarint(buf, pos)[1];
    } else {
      pos += wireType === WT_FIXED64 ? 8 : 4;
    }
  }
  return null;
}

function decodeStruct(buf: Buffer): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of decodeFields(buf)) {
    if (field.fieldNumber !== STRUCT_FIELDS || field.wireType !== WT_LEN) continue;
    const entry = decodeMapEntry(field.bytes);
    if (entry) result[entry.key] = entry.value;
  }
  return result;
}

/** One `map<string, Value>` entry (a struct field or a tool argument). */
export function decodeMapEntry(buf: Buffer): { key: string; value: unknown } | null {
  const fields = decodeFields(buf);
  const key = stringOf(fields, MAP_KEY);
  const value = bytesOf(fields, MAP_VALUE);
  return key && value ? { key, value: decodeValue(value) } : null;
}

// ---------- Connect-RPC framing ----------

const FLAG_GZIP = 0x01;
/** The last frame of a server stream: JSON, `{}` or `{ "error": ... }`, not protobuf. */
export const FLAG_END_STREAM = 0x02;
/** Real frames are far smaller; a bigger length means a broken or hostile stream. */
export const MAX_FRAME_BYTES = 16 * 1024 * 1024;

/** One message as a Connect frame: flags byte, 4-byte big-endian length, payload. */
export function frame(payload: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export function gzipFrame(payload: Buffer): Buffer {
  const data = gzipSync(payload);
  const header = Buffer.alloc(5);
  header.writeUInt8(FLAG_GZIP, 0);
  header.writeUInt32BE(data.length, 1);
  return Buffer.concat([header, data]);
}

export interface ConnectFrame {
  flags: number;
  payload: Buffer;
}

/**
 * Takes whole frames off the front of `buf`. Returns them with the bytes left over (the start
 * of a frame still arriving).
 */
export function takeFrames(buf: Buffer): { frames: ConnectFrame[]; rest: Buffer } {
  const frames: ConnectFrame[] = [];
  let pos = 0;
  while (pos + 5 <= buf.length) {
    const flags = buf.readUInt8(pos);
    const length = buf.readUInt32BE(pos + 1);
    if (length > MAX_FRAME_BYTES) throw new Error('Cursor sent an oversized frame.');
    if (pos + 5 + length > buf.length) break;
    const raw = buf.subarray(pos + 5, pos + 5 + length);
    frames.push({ flags, payload: flags & FLAG_GZIP ? gunzipSync(raw) : Buffer.from(raw) });
    pos += 5 + length;
  }
  return { frames, rest: buf.subarray(pos) };
}
