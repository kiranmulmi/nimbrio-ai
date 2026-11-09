import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { INPUT, INPUT_ERROR, INPUT_OK, LABEL } from '../../components/form';
import { Spinner } from '../../components/Spinner';
import { ArrowLeftIcon, GoogleIcon, MailIcon } from '../../lib/icons';
import { useNow } from '../../lib/useNow';
import { AuthCard } from './AuthCard';
import { describeAuthError, type AuthFix, type AuthProblem } from './authErrors';
import { OUTLINE_BUTTON, PRIMARY_BUTTON, TEXT_LINK } from './authStyles';
import { isEmail, MIN_PASSWORD_LENGTH } from './password';
import { PasswordInput, PasswordStrengthMeter } from './PasswordInput';
import { ProblemBox } from './ProblemBox';

type View =
  | { kind: 'signIn' }
  | { kind: 'signUp' }
  | { kind: 'forgot' }
  | { kind: 'sent'; reason: 'confirm' | 'reset'; email: string };

type GoogleState = 'checking' | 'on' | 'off';

/** Seconds before the same email can be sent again (Supabase limits how often it sends). */
const RESEND_AFTER_S = 60;

/** Whether the Supabase project has Google sign-in turned on, from its public settings. */
function useGoogleSignIn(supabaseUrl: string, anonKey: string): GoogleState {
  const [state, setState] = useState<GoogleState>('checking');
  useEffect(() => {
    let isCurrent = true;
    fetch(`${supabaseUrl}/auth/v1/settings`, { headers: { apikey: anonKey } })
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
      .then(
        (settings) => isCurrent && setState(isGoogleOn(settings) ? 'on' : 'off'),
        () => isCurrent && setState('off'),
      );
    return () => {
      isCurrent = false;
    };
  }, [supabaseUrl, anonKey]);
  return state;
}

function isGoogleOn(settings: unknown): boolean {
  if (typeof settings !== 'object' || settings === null || !('external' in settings)) return false;
  const { external } = settings;
  return typeof external === 'object' && external !== null && 'google' in external
    ? external.google === true
    : false;
}

/**
 * Sign in or create an account in the Supabase project the API names: with Google (when the
 * project has it on) or an email and password, plus the reset-password and confirm-email steps.
 */
export function LoginPage({
  client,
  supabaseUrl,
  anonKey,
  redirectError,
  onSkip,
}: {
  client: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
  /** Why the last sign-in through Google or an email link didn't finish. */
  redirectError: string | null;
  /** Back to the app without signing in; absent when sign-in is required. */
  onSkip?: () => void;
}) {
  const [view, setView] = useState<View>({ kind: 'signIn' });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [hasTriedSubmit, setHasTriedSubmit] = useState(false);
  const [isEmailTouched, setIsEmailTouched] = useState(false);
  const [problem, setProblem] = useState<AuthProblem | null>(
    redirectError ? { message: redirectError } : null,
  );
  const [isBusy, setIsBusy] = useState(false);
  const [isGoingToGoogle, setIsGoingToGoogle] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const google = useGoogleSignIn(supabaseUrl, anonKey);
  const now = useNow(resendAt > Date.now());
  const resendInS = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const redirectTo = window.location.origin;
  const trimmedEmail = email.trim();
  const emailError =
    (isEmailTouched || hasTriedSubmit) && !isEmail(trimmedEmail)
      ? trimmedEmail
        ? 'Enter a valid email address, like name@example.com.'
        : 'Enter your email.'
      : null;
  const isSignUp = view.kind === 'signUp';
  const passwordError =
    hasTriedSubmit && (view.kind === 'signIn' || isSignUp)
      ? !password
        ? 'Enter your password.'
        : isSignUp && password.length < MIN_PASSWORD_LENGTH
          ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
          : null
      : null;

  function go(next: View) {
    setView(next);
    setProblem(null);
    setHasTriedSubmit(false);
    setIsEmailTouched(false);
  }

  /** Runs one Supabase call with the busy state and errors handled. */
  async function attempt(action: () => Promise<void>) {
    setIsBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (cause) {
      setProblem(describeAuthError(cause));
    } finally {
      setIsBusy(false);
    }
  }

  function sent(reason: 'confirm' | 'reset') {
    setResendAt(Date.now() + RESEND_AFTER_S * 1000);
    go({ kind: 'sent', reason, email: trimmedEmail });
  }

  async function sendConfirmation(to: string) {
    const { error } = await client.auth.resend({
      type: 'signup',
      email: to,
      options: { emailRedirectTo: redirectTo },
    });
    if (error) throw error;
  }

  async function sendReset(to: string) {
    const { error } = await client.auth.resetPasswordForEmail(to, { redirectTo });
    if (error) throw error;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    setHasTriedSubmit(true);
    if (!isEmail(trimmedEmail)) return;
    if (view.kind === 'forgot') {
      void attempt(async () => {
        await sendReset(trimmedEmail);
        sent('reset');
      });
      return;
    }
    if (!password || (isSignUp && password.length < MIN_PASSWORD_LENGTH)) return;
    void attempt(async () => {
      if (isSignUp) {
        const { data, error } = await client.auth.signUp({
          email: trimmedEmail,
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (error) throw error;
        // Supabase answers a sign-up for a taken email with a user that has no identities,
        // rather than an error, so that nobody can probe which emails have accounts.
        if (data.user && data.user.identities?.length === 0) {
          setProblem({ message: 'There is already an account with this email.', fix: 'signIn' });
        } else if (!data.session) {
          sent('confirm');
        }
        // With a session, AuthGate takes over.
      } else {
        const { error } = await client.auth.signInWithPassword({ email: trimmedEmail, password });
        if (error) throw error;
      }
    });
  }

  function fix(next: AuthFix) {
    if (next === 'signIn') go({ kind: 'signIn' });
    else if (next === 'resetPassword') go({ kind: 'forgot' });
    else {
      void attempt(async () => {
        await sendConfirmation(trimmedEmail);
        sent('confirm');
      });
    }
  }

  async function continueWithGoogle() {
    setIsGoingToGoogle(true);
    setProblem(null);
    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        // Lets someone with several Google accounts pick one, instead of reusing the last.
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      });
      if (error) throw error;
      // The browser is now leaving for Google, so the spinner stays.
    } catch (cause) {
      setProblem(describeAuthError(cause));
      setIsGoingToGoogle(false);
    }
  }

  const problemBox = problem && (
    <ProblemBox problem={problem} onFix={fix} isDisabled={isBusy || isGoingToGoogle} />
  );

  if (view.kind === 'sent') {
    const isReset = view.reason === 'reset';
    return (
      <AuthCard
        title="Check your email"
        subtitle={
          <>
            We sent a link to <strong className="font-semibold text-ink">{view.email}</strong>. Open
            it to {isReset ? 'choose a new password' : 'confirm your account'}.
          </>
        }
      >
        <div className="mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-accent-soft text-accent-2">
          <MailIcon size={26} />
        </div>
        <p className="text-[13px] leading-relaxed text-ink-3">
          No email after a minute? Check your spam folder, or send it again.
        </p>
        {problemBox}
        <button
          type="button"
          className={`${OUTLINE_BUTTON} mt-5`}
          disabled={isBusy || resendInS > 0}
          onClick={() =>
            void attempt(async () => {
              await (isReset ? sendReset(view.email) : sendConfirmation(view.email));
              setResendAt(Date.now() + RESEND_AFTER_S * 1000);
            })
          }
        >
          {isBusy && <Spinner size={15} label="Sending" />}
          {resendInS > 0 ? `Send again in ${resendInS}s` : 'Send the email again'}
        </button>
        <BackToSignIn onClick={() => go({ kind: 'signIn' })} />
      </AuthCard>
    );
  }

  if (view.kind === 'forgot') {
    return (
      <AuthCard
        title="Reset your password"
        subtitle="Enter the email you signed up with and we'll send you a link to choose a new password."
      >
        <form onSubmit={submit} noValidate>
          <EmailField
            value={email}
            onChange={setEmail}
            onBlur={() => setIsEmailTouched(true)}
            error={emailError}
          />
          {problemBox}
          <button type="submit" className={`${PRIMARY_BUTTON} mt-6`} disabled={isBusy}>
            {isBusy && <Spinner size={15} label="Sending" />}
            Send reset link
          </button>
        </form>
        <BackToSignIn onClick={() => go({ kind: 'signIn' })} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={isSignUp ? 'Create your account' : 'Welcome back'}
      subtitle={
        isSignUp
          ? 'Set up your account and start chatting with your agent.'
          : onSkip
            ? 'Sign in to pick up where you left off. You can also use the app without an account.'
            : 'Sign in to pick up where you left off.'
      }
    >
      <ModeTabs isSignUp={isSignUp} onChange={(next) => go({ kind: next })} />

      {google === 'on' && (
        <>
          <button
            type="button"
            className={`${OUTLINE_BUTTON} mt-6`}
            onClick={() => void continueWithGoogle()}
            disabled={isGoingToGoogle || isBusy}
          >
            {isGoingToGoogle ? <Spinner size={16} label="Opening Google" /> : <GoogleIcon />}
            Continue with Google
          </button>
          <div className="my-6 flex items-center gap-3 text-[12px] font-medium text-ink-3">
            <span className="h-px flex-1 bg-line" />
            or with email
            <span className="h-px flex-1 bg-line" />
          </div>
        </>
      )}

      <form onSubmit={submit} noValidate className={google === 'on' ? undefined : 'mt-6'}>
        <EmailField
          value={email}
          onChange={setEmail}
          onBlur={() => setIsEmailTouched(true)}
          error={emailError}
          autoFocus={google !== 'on'}
        />
        <div className="mt-5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className={LABEL}>
              Password
            </label>
            {!isSignUp && (
              <button
                type="button"
                className={`${TEXT_LINK} text-[13px]`}
                onClick={() => go({ kind: 'forgot' })}
              >
                Forgot password?
              </button>
            )}
          </div>
          <PasswordInput
            id="password"
            autoComplete={isSignUp ? 'new-password' : 'current-password'}
            placeholder={isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hasError={Boolean(passwordError)}
            aria-invalid={Boolean(passwordError)}
            aria-describedby={passwordError ? 'password-error' : undefined}
          />
          {passwordError ? (
            <FieldError id="password-error">{passwordError}</FieldError>
          ) : (
            isSignUp && (
              <PasswordStrengthMeter password={password} minLength={MIN_PASSWORD_LENGTH} />
            )
          )}
        </div>
        {problemBox}
        <button
          type="submit"
          className={`${PRIMARY_BUTTON} mt-6`}
          disabled={isBusy || isGoingToGoogle}
        >
          {isBusy && <Spinner size={15} label={isSignUp ? 'Creating account' : 'Signing in'} />}
          {isSignUp ? 'Create account' : 'Sign in'}
        </button>
      </form>

      <p className="mt-6 text-center text-[13.5px] text-ink-3">
        {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
        <button
          type="button"
          className={TEXT_LINK}
          onClick={() => go({ kind: isSignUp ? 'signIn' : 'signUp' })}
        >
          {isSignUp ? 'Sign in' : 'Create one'}
        </button>
      </p>
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          className="mx-auto mt-4 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-3 hover:text-ink focus-visible:text-ink focus-visible:outline-none"
        >
          Continue without signing in
        </button>
      )}
    </AuthCard>
  );
}

function ModeTabs({
  isSignUp,
  onChange,
}: {
  isSignUp: boolean;
  onChange: (mode: 'signIn' | 'signUp') => void;
}) {
  const tabs = [
    { mode: 'signIn', label: 'Sign in', isSelected: !isSignUp },
    { mode: 'signUp', label: 'Create account', isSelected: isSignUp },
  ] as const;
  return (
    <div
      role="tablist"
      aria-label="Sign in or create an account"
      className="grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
    >
      {tabs.map((tab) => (
        <button
          key={tab.mode}
          type="button"
          role="tab"
          aria-selected={tab.isSelected}
          onClick={() => onChange(tab.mode)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onChange(isSignUp ? 'signIn' : 'signUp');
            }
          }}
          tabIndex={tab.isSelected ? 0 : -1}
          className={`h-9 rounded-lg text-[13.5px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
            tab.isSelected ? 'bg-surface text-ink shadow-card' : 'text-ink-3 hover:text-ink'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function EmailField({
  value,
  onChange,
  onBlur,
  error,
  autoFocus = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  error: string | null;
  autoFocus?: boolean;
}) {
  return (
    <div>
      <label htmlFor="email" className={LABEL}>
        Email
      </label>
      <input
        id="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        autoCapitalize="none"
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder="name@example.com"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? 'email-error' : undefined}
        className={`${INPUT} ${error ? INPUT_ERROR : INPUT_OK} h-11 font-normal`}
      />
      {error && <FieldError id="email-error">{error}</FieldError>}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1.5 text-[12.5px] text-danger">
      {children}
    </p>
  );
}

function BackToSignIn({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-auto mt-6 flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-3 hover:text-ink focus-visible:text-ink focus-visible:outline-none"
    >
      <ArrowLeftIcon /> Back to sign in
    </button>
  );
}
