/** The shortest password the app accepts for a new account or a reset. */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordStrength = 0 | 1 | 2 | 3;

/** A rough guide for the meter: length plus the kinds of character used. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 0;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((kind) =>
    kind.test(password),
  ).length;
  if (password.length >= 12 && kinds >= 3) return 3;
  if (kinds >= 2) return 2;
  return 1;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return EMAIL.test(value.trim());
}
