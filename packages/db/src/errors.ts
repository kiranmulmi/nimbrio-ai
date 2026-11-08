/** Bad input from the user (a name too long, ...). The API answers it with HTTP 400. */
export class InputError extends Error {
  override name = 'InputError';
}
