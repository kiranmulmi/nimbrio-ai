import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';
import type { AuthUser } from '@app/shared';

/** What the sign-in provider knows about the user beyond the email (Google gives both). */
export interface AuthProfile {
  name: string | null;
  /** https only */
  avatarUrl: string | null;
}

/** The signed-in user, and how to sign out. */
export interface AuthState {
  user: AuthUser;
  profile: AuthProfile;
  signOut: () => Promise<void>;
}

/** null when the app runs without sign-in. */
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState | null {
  return useContext(AuthContext);
}

const NO_PROFILE: AuthProfile = { name: null, avatarUrl: null };

/** The name and photo from a Supabase user's metadata, as Google and most providers fill it. */
export function profileOf(user: User | null | undefined): AuthProfile {
  if (!user) return NO_PROFILE;
  const metadata: Record<string, unknown> = user.user_metadata;
  const text = (key: string): string | null => {
    const value = metadata[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };
  const avatar = text('avatar_url') ?? text('picture');
  return {
    name: text('full_name') ?? text('name'),
    avatarUrl: avatar?.startsWith('https://') ? avatar : null,
  };
}
