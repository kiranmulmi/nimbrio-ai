import { isAuthError, isAuthRetryableFetchError } from '@supabase/supabase-js';

/** A next step the login page can offer next to an error. */
export type AuthFix = 'resendConfirmation' | 'signIn' | 'resetPassword';

export interface AuthProblem {
  message: string;
  fix?: AuthFix;
}

const OFFLINE = "Can't reach the sign-in server. Check your connection and try again.";

/** Supabase's errors in plain words, with the step that gets the user past them. */
export function describeAuthError(error: unknown): AuthProblem {
  if (!isAuthError(error) || isAuthRetryableFetchError(error)) return { message: OFFLINE };
  switch (error.code) {
    case 'invalid_credentials':
      return { message: "That email and password don't match.", fix: 'resetPassword' };
    case 'email_not_confirmed':
      return {
        message: 'Confirm your email first: open the link we sent you.',
        fix: 'resendConfirmation',
      };
    case 'user_already_exists':
    case 'email_exists':
      return { message: 'There is already an account with this email.', fix: 'signIn' };
    case 'email_address_invalid':
      return { message: 'Enter a valid email address.' };
    case 'same_password':
      return { message: 'Choose a password different from your current one.' };
    case 'over_email_send_rate_limit':
      return { message: 'Too many emails sent. Wait a minute, then try again.' };
    case 'over_request_rate_limit':
      return { message: 'Too many attempts. Wait a moment, then try again.' };
    case 'signup_disabled':
      return { message: 'New accounts are turned off for this app.' };
    case 'provider_disabled':
      return { message: 'This sign-in method is turned off for this app.' };
    default:
      return { message: error.message || OFFLINE };
  }
}

/** What Supabase sent back in the URL after a sign-in elsewhere (Google, an email link) failed. */
export function readRedirectError(): string | null {
  const sources = [
    new URLSearchParams(window.location.search),
    new URLSearchParams(window.location.hash.slice(1)),
  ];
  for (const params of sources) {
    const code = params.get('error_code') ?? params.get('error');
    if (!code) continue;
    if (code === 'access_denied' && !params.get('error_description')) {
      return 'Sign-in was cancelled.';
    }
    if (code === 'otp_expired')
      return 'That link has expired or was already used. Ask for a new one.';
    return params.get('error_description')?.replace(/\+/g, ' ') ?? 'Sign-in did not finish.';
  }
  return null;
}
