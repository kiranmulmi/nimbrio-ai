import type { SupabaseClient } from '@supabase/supabase-js';
import { useState, type FormEvent } from 'react';
import { LABEL } from '../../components/form';
import { Spinner } from '../../components/Spinner';
import { useToast } from '../../lib/toast';
import { AuthCard } from './AuthCard';
import { describeAuthError } from './authErrors';
import { PRIMARY_BUTTON } from './authStyles';
import { MIN_PASSWORD_LENGTH } from './password';
import { PasswordInput, PasswordStrengthMeter } from './PasswordInput';
import { ProblemBox } from './ProblemBox';

/** After a reset-password link: the user is signed in for this, and picks the new password. */
export function SetPasswordPage({
  client,
  email,
  onDone,
}: {
  client: SupabaseClient;
  email: string | null;
  onDone: () => void;
}) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const isTooShort = password.length < MIN_PASSWORD_LENGTH;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setHasTriedSubmit(true);
    if (isTooShort) return;
    setIsBusy(true);
    setProblem(null);
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      toast('Password updated');
      onDone();
    } catch (cause) {
      setProblem(describeAuthError(cause).message);
      setIsBusy(false);
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      subtitle={
        email ? (
          <>
            For <strong className="font-semibold text-ink">{email}</strong>.
          </>
        ) : undefined
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate>
        <label htmlFor="new-password" className={LABEL}>
          New password
        </label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          autoFocus
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          hasError={hasTriedSubmit && isTooShort}
          aria-invalid={hasTriedSubmit && isTooShort}
        />
        <PasswordStrengthMeter password={password} minLength={MIN_PASSWORD_LENGTH} />
        {problem && <ProblemBox problem={{ message: problem }} />}
        <button type="submit" disabled={isBusy} className={`${PRIMARY_BUTTON} mt-6`}>
          {isBusy && <Spinner size={15} label="Saving" />}
          Save and continue
        </button>
      </form>
    </AuthCard>
  );
}
