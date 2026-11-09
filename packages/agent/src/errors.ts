// Narrowing helpers for caught values, which TypeScript types as unknown.

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The `code` of a Node or driver error (ENOENT, 3D000, ...), if it has one. */
export function errorCode(error: unknown): string | undefined {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const { code } = error;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The run was stopped by the user while this call was in flight. */
export class StoppedError extends Error {
  constructor() {
    super('Stopped by the user.');
    this.name = 'StoppedError';
  }
}
