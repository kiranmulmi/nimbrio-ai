import { z } from 'zod';
import { ValidationError } from './errors.js';

export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new ValidationError(first?.message ?? 'Invalid input');
  }
  return result.data;
}
