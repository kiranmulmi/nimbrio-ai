import { useState } from 'react';
import { ChevronDownIcon, SignOutIcon } from '../../lib/icons';
import { usePopover } from '../../lib/usePopover';
import { useAuth, type AuthState } from './authContext';

const ITEM =
  'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] outline-none transition-colors hover:bg-subtle focus-visible:bg-subtle';

/** "Kiran Mulmi" → "KM"; "kiran.mulmi@gmail.com" → "KM"; nothing usable → "?". */
export function initialsOf(name: string | null, email: string | null): string {
  const source = name ?? email?.split('@')[0] ?? '';
  const words = source.split(/[\s._-]+/).filter(Boolean);
  const first = words[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1] ?? '') : '';
  const letters = last ? first.charAt(0) + last.charAt(0) : first.slice(0, 2);
  return letters.toUpperCase() || '?';
}

/** The provider's photo, or the user's initials when there is none or it won't load. */
function Avatar({ auth, size }: { auth: AuthState; size: number }) {
  const [hasFailed, setHasFailed] = useState(false);
  const { avatarUrl, name } = auth.profile;
  if (avatarUrl && !hasFailed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setHasFailed(true)}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid shrink-0 place-items-center rounded-full bg-accent font-bold text-on-accent"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initialsOf(name, auth.user.email)}
    </span>
  );
}

/**
 * Who is signed in, at the foot of the chats sidebar: photo or initials, name and email, and a
 * menu (opening upward) with Sign out. Nothing when the app runs without sign-in.
 */
export function AccountMenu() {
  const auth = useAuth();
  const { isOpen, setIsOpen, ref } = usePopover<HTMLDivElement>();
  if (!auth) return null;
  const { email } = auth.user;
  const name = auth.profile.name ?? email?.split('@')[0] ?? 'Signed in';

  return (
    <div ref={ref} className="relative shrink-0 border-t border-line-2">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        title={email ? `Signed in as ${email}` : undefined}
        className={`flex h-14 w-full min-w-0 items-center gap-2.5 px-4 text-left transition-colors ${
          isOpen ? 'bg-subtle' : 'hover:bg-subtle'
        }`}
      >
        <Avatar auth={auth} size={30} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold text-ink">{name}</span>
          {email && <span className="block truncate text-[12px] text-ink-3">{email}</span>}
        </span>
        <ChevronDownIcon
          className={`shrink-0 text-ink-3 transition-transform ${isOpen ? '' : 'rotate-180'}`}
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          className="absolute inset-x-2 bottom-[calc(100%+4px)] z-30 overflow-hidden rounded-xl border border-line bg-surface shadow-float"
        >
          <div className="flex items-center gap-3 border-b border-line-2 px-3 py-3">
            <Avatar auth={auth} size={36} />
            <div className="min-w-0">
              <p className="truncate text-[13.5px] font-semibold text-ink">{name}</p>
              {email && <p className="truncate text-[12px] text-ink-3">{email}</p>}
            </div>
          </div>
          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                void auth.signOut();
              }}
              className={`${ITEM} text-ink-2 hover:text-ink`}
            >
              <span className="grid h-6 w-6 place-items-center text-ink-3">
                <SignOutIcon size={14} />
              </span>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
