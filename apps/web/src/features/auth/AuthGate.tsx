import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthConfig, AuthUser } from '@app/shared';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { ApiError, errorMessage, request, setAuthHandlers } from '../../lib/api';
import { AuthContext, profileOf, type AuthProfile, type AuthState } from './authContext';
import { AuthCard } from './AuthCard';
import { readRedirectError } from './authErrors';
import { LoginPage } from './LoginPage';
import { SetPasswordPage } from './SetPasswordPage';

/** Whether the signed-in user may use the app, as the API sees it. */
type Access =
  | { kind: 'checking' }
  | { kind: 'allowed'; user: AuthUser }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; error: unknown };

/**
 * Shows the app only to a signed-in user when the API has sign-in on (`GET /v1/auth/config`),
 * and the login page otherwise. Every API request then carries the Supabase access token.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [configError, setConfigError] = useState<unknown>(null);
  // Read before Supabase handles the URL: what a Google or email-link return carried.
  const [redirect] = useState(() => ({
    error: readRedirectError(),
    isRecovery: new URLSearchParams(window.location.hash.slice(1)).get('type') === 'recovery',
  }));

  useEffect(() => {
    // A failed return leaves its error in the URL; drop it so a reload doesn't show it again.
    if (redirect.error) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, [redirect.error]);

  useEffect(() => {
    let isCurrent = true;
    request<AuthConfig>('/auth/config').then(
      (loaded) => isCurrent && setConfig(loaded),
      (cause: unknown) => isCurrent && setConfigError(cause),
    );
    return () => {
      isCurrent = false;
    };
  }, []);

  const client = useMemo(
    () => (config?.isEnabled ? createClient(config.supabaseUrl, config.supabaseAnonKey) : null),
    [config],
  );

  if (configError) {
    return (
      <AuthCard title="Can't reach the server">
        <p className="text-[14px] text-ink-2">{errorMessage(configError)}</p>
        <Button variant="primary" className="mt-5 w-full" onClick={() => window.location.reload()}>
          Try again
        </Button>
      </AuthCard>
    );
  }
  if (!config) return <PageLoader />;
  if (!client || !config.isEnabled) {
    return <AuthContext.Provider value={null}>{children}</AuthContext.Provider>;
  }
  return (
    <SignedInOnly
      client={client}
      supabaseUrl={config.supabaseUrl}
      anonKey={config.supabaseAnonKey}
      redirectError={redirect.error}
      isRecoveryLink={redirect.isRecovery}
    >
      {children}
    </SignedInOnly>
  );
}

function SignedInOnly({
  client,
  supabaseUrl,
  anonKey,
  redirectError,
  isRecoveryLink,
  children,
}: {
  client: SupabaseClient;
  supabaseUrl: string;
  anonKey: string;
  redirectError: string | null;
  isRecoveryLink: boolean;
  children: ReactNode;
}) {
  // undefined until Supabase has read the saved session
  const [userId, setUserId] = useState<string | null | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<AuthProfile>(() => profileOf(null));
  const [access, setAccess] = useState<Access>({ kind: 'checking' });
  // Signed in by a reset-password link: a new password comes first.
  const [isSettingPassword, setIsSettingPassword] = useState(isRecoveryLink);

  useEffect(() => {
    setAuthHandlers({
      accessToken: async () => (await client.auth.getSession()).data.session?.access_token ?? null,
      onSignedOut: () => void client.auth.signOut({ scope: 'local' }),
    });
    // Supabase asks not to call it from inside this callback, so it only notes the user.
    const { data } = client.auth.onAuthStateChange((event, session) => {
      setUserId(session?.user.id ?? null);
      setEmail(session?.user.email ?? null);
      setProfile(profileOf(session?.user));
      if (event === 'PASSWORD_RECOVERY') setIsSettingPassword(true);
      if (event === 'SIGNED_OUT') setIsSettingPassword(false);
    });
    return () => {
      data.subscription.unsubscribe();
      setAuthHandlers(null);
    };
  }, [client]);

  useEffect(() => {
    if (!userId) return;
    let isCurrent = true;
    setAccess({ kind: 'checking' });
    request<AuthUser | null>('/auth/me').then(
      (user) => {
        if (!isCurrent) return;
        setAccess(user ? { kind: 'allowed', user } : { kind: 'failed', error: null });
      },
      (cause: unknown) => {
        if (!isCurrent) return;
        setAccess(
          cause instanceof ApiError && cause.status === 403
            ? { kind: 'refused', message: cause.message }
            : { kind: 'failed', error: cause },
        );
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [userId]);

  const state = useMemo<AuthState | null>(
    () =>
      access.kind === 'allowed'
        ? {
            user: access.user,
            profile,
            signOut: async () => {
              await client.auth.signOut();
            },
          }
        : null,
    [access, client, profile],
  );

  if (userId === undefined) return <PageLoader />;
  if (userId === null) {
    return (
      <LoginPage
        client={client}
        supabaseUrl={supabaseUrl}
        anonKey={anonKey}
        redirectError={redirectError}
      />
    );
  }
  if (isSettingPassword) {
    return (
      <SetPasswordPage client={client} email={email} onDone={() => setIsSettingPassword(false)} />
    );
  }
  if (access.kind === 'checking') return <PageLoader label="Signing in…" />;
  if (access.kind !== 'allowed') {
    return (
      <AuthCard title={access.kind === 'refused' ? 'No access' : "Couldn't sign in"}>
        <p className="text-[14px] text-ink-2">
          {access.kind === 'refused'
            ? access.message
            : errorMessage(access.error, 'The server did not accept the sign-in.')}
        </p>
        <Button className="mt-5 w-full" onClick={() => void client.auth.signOut()}>
          Sign in with another account
        </Button>
      </AuthCard>
    );
  }
  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}
