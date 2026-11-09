import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { ProviderAccount, ProviderLogin } from '@app/shared';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { ConfirmDeleteDialog } from '../../components/ConfirmDeleteDialog';
import { PageLoader } from '../../components/PageLoader';
import { Spinner } from '../../components/Spinner';
import { usePageHeader } from '../../layout/pageHeader';
import { errorMessage, isNotFound } from '../../lib/api';
import { APP_NAME } from '../../lib/brand';
import { LinkIcon } from '../../lib/icons';
import { fromPath } from '../../lib/routerState';
import { useAsync } from '../../lib/useAsync';
import { useToast } from '../../lib/toast';
import { SettingsTabs } from '../settings/SettingsTabs';
import { CursorModelList } from './CursorModelList';
import {
  cancelCursorLogin,
  fetchCursorLogin,
  fetchProviders,
  signOutCursor,
  startCursorLogin,
} from './api';

const POLL_MS = 2000;
/** Failed polls in a row (Cursor unreachable, say) before giving up on a sign-in. */
const MAX_POLL_FAILURES = 3;

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const formatDate = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : '');

/**
 * `/settings/providers`: model providers that sign in with your account on their website
 * instead of an API key. Today that's Cursor: its browser sign-in, who is signed in, sign out.
 */
export function ProvidersPage() {
  const location = useLocation();
  const toast = useToast();
  const providers = useAsync(fetchProviders);
  const { setData } = providers;
  const [login, setLogin] = useState<ProviderLogin | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirmingSignOut, setIsConfirmingSignOut] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const backTo = fromPath(location.state) ?? '/';

  usePageHeader({
    title: 'Settings',
    subtitle: 'Providers you sign in to with your own account instead of an API key.',
    breadcrumbs: [{ label: APP_NAME, to: backTo }, { label: 'Settings' }],
  });

  const showAccount = useCallback(
    (account: ProviderAccount) =>
      setData((list) =>
        (list ?? [account]).map((item) => (item.provider === account.provider ? account : item)),
      ),
    [setData],
  );

  // While a sign-in waits, ask the server every couple of seconds whether the user finished
  // on cursor.com. Leaving the page (or cancelling) forgets the sign-in on the server too.
  useEffect(() => {
    if (!login) return;
    let isActive = true;
    let isFinished = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const stop = () => {
      isFinished = true;
      setLogin(null);
    };

    const poll = async () => {
      try {
        const result = await fetchCursorLogin(login.loginId);
        if (!isActive) return;
        if (result.status === 'connected') {
          stop();
          showAccount(result.account);
          const who = result.account.email ? ` as ${result.account.email}` : '';
          toast(`Signed in to Cursor${who}`);
          return;
        }
        failures = 0;
      } catch (cause) {
        if (!isActive) return;
        failures += 1;
        if (isNotFound(cause) || failures >= MAX_POLL_FAILURES) {
          stop();
          toast(errorMessage(cause, "Couldn't finish signing in to Cursor."), 'error');
          return;
        }
      }
      timer = setTimeout(() => void poll(), POLL_MS);
    };

    timer = setTimeout(() => void poll(), POLL_MS);
    return () => {
      isActive = false;
      clearTimeout(timer);
      if (!isFinished) void cancelCursorLogin(login.loginId).catch(() => undefined);
    };
  }, [login, showAccount, toast]);

  const signIn = async () => {
    setIsStarting(true);
    try {
      const started = await startCursorLogin();
      setLogin(started);
      // May be blocked as a popup; the waiting card links to the page as well.
      window.open(started.loginUrl, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't start the Cursor sign-in."), 'error');
    } finally {
      setIsStarting(false);
    }
  };

  const cancelSignOut = useCallback(() => setIsConfirmingSignOut(false), []);

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutCursor();
      providers.reload();
      toast('Signed out of Cursor');
    } catch (cause) {
      toast(errorMessage(cause, "Couldn't sign out of Cursor."), 'error');
    } finally {
      setIsSigningOut(false);
      setIsConfirmingSignOut(false);
    }
  };

  const cursor = providers.data?.find((account) => account.provider === 'cursor');

  return (
    <div className="w-full">
      <SettingsTabs />

      {!providers.data && providers.error ? (
        <p
          role="alert"
          className="border border-l-[3px] border-line border-l-danger-line bg-danger-bg px-4 py-3 text-[13px] text-danger"
        >
          {errorMessage(providers.error, "Couldn't load the providers.")}
        </p>
      ) : !cursor ? (
        <PageLoader />
      ) : (
        <>
          <section className="panel px-5 py-5 sm:px-6" aria-labelledby="cursor-provider">
            <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
              <span
                aria-hidden="true"
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[15px] font-bold ${
                  cursor.isConnected ? 'bg-accent-soft text-accent' : 'bg-surface-2 text-ink-3'
                }`}
              >
                C
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <h2 id="cursor-provider" className="text-[14px] font-medium text-ink">
                    Cursor
                  </h2>
                  {cursor.isConnected && !cursor.needsSignIn && (
                    <Badge tone="green">signed in</Badge>
                  )}
                  {cursor.needsSignIn && <Badge tone="yellow">sign in again</Badge>}
                </div>
                <p className="mt-0.5 text-[13px] text-ink-3">
                  {cursor.isConnected ? (
                    <>
                      <span className="text-ink-2">{cursor.email ?? cursor.accountId}</span>
                      {cursor.connectedAt && ` · since ${formatDate(cursor.connectedAt)}`}
                    </>
                  ) : (
                    'Sign in with your Cursor account in the browser.'
                  )}
                </p>
              </div>
              {!login && (
                <div className="flex shrink-0 flex-wrap gap-2">
                  {cursor.isConnected && (
                    <Button onClick={() => setIsConfirmingSignOut(true)} disabled={isStarting}>
                      Sign out
                    </Button>
                  )}
                  {(!cursor.isConnected || cursor.needsSignIn) && (
                    <Button variant="primary" onClick={() => void signIn()} disabled={isStarting}>
                      {isStarting && <Spinner size={13} />}
                      {cursor.needsSignIn ? 'Sign in again' : 'Sign in with Cursor'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {login && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-l-[3px] border-accent bg-accent-bg px-4 py-3">
                <Spinner size={14} label="Waiting for the sign-in" />
                <p className="min-w-0 flex-1 text-[13px] text-ink-2">
                  Finish signing in on cursor.com. This page updates by itself.
                </p>
                <a
                  href={login.loginUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-7 items-center gap-1.5 rounded-xl px-3 text-[12px] font-semibold text-accent-2 hover:bg-accent-soft"
                >
                  <LinkIcon size={12} /> Open sign-in page
                </a>
                <Button size="sm" onClick={() => setLogin(null)}>
                  Cancel
                </Button>
              </div>
            )}
          </section>

          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            The sign-in is kept on this machine only, in {APP_NAME}&rsquo;s private settings folder.
            Models you add below run on your Cursor plan, through this sign-in.
          </p>

          {cursor.isConnected && !cursor.needsSignIn && <CursorModelList />}
        </>
      )}

      <ConfirmDeleteDialog
        open={isConfirmingSignOut}
        title="Sign out of Cursor?"
        message="The saved Cursor sign-in is removed from this machine. You can sign in again any time."
        confirmLabel="Sign out"
        busyLabel="Signing out…"
        busy={isSigningOut}
        onCancel={cancelSignOut}
        onConfirm={() => void signOut()}
      />
    </div>
  );
}
