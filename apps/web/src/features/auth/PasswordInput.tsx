import { useState, type InputHTMLAttributes } from 'react';
import { INPUT, INPUT_ERROR, INPUT_OK } from '../../components/form';
import { EyeIcon, EyeOffIcon } from '../../lib/icons';
import { passwordStrength } from './password';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  hasError?: boolean;
};

/** A password box with a button that shows what was typed. */
export function PasswordInput({ hasError = false, ...rest }: Props) {
  const [isShown, setIsShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={isShown ? 'text' : 'password'}
        className={`${INPUT} ${hasError ? INPUT_ERROR : INPUT_OK} h-11 pr-11 font-normal`}
      />
      <button
        type="button"
        onClick={() => setIsShown((shown) => !shown)}
        aria-label={isShown ? 'Hide password' : 'Show password'}
        aria-pressed={isShown}
        className="absolute bottom-0 right-1 grid h-11 w-10 place-items-center rounded-xl text-ink-3 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {isShown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

const STRENGTH_LABELS = ['Too short', 'Weak', 'Good', 'Strong'] as const;
const STRENGTH_COLOURS = ['bg-line', 'bg-danger-line', 'bg-warn-line', 'bg-success-line'] as const;

/** Three bars and a word under a new password; the rule while it is too short. */
export function PasswordStrengthMeter({
  password,
  minLength,
}: {
  password: string;
  minLength: number;
}) {
  const strength = passwordStrength(password);
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1.5" aria-hidden>
        {[1, 2, 3].map((level) => (
          <span
            key={level}
            className={`h-1 flex-1 rounded-full transition-colors ${
              password && strength >= level ? STRENGTH_COLOURS[strength] : 'bg-line'
            }`}
          />
        ))}
      </div>
      <p className="mt-1.5 text-[12.5px] text-ink-3">
        {!password || strength === 0
          ? `Use at least ${minLength} characters.`
          : `${STRENGTH_LABELS[strength]}.${strength < 3 ? ' Make it longer, or add capitals, numbers or symbols.' : ''}`}
      </p>
    </div>
  );
}
