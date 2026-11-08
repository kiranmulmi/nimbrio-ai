import { Link } from 'react-router-dom';
import { LogoIcon } from '../lib/icons';

/**
 * The app's logo and name ("Nimbrio AI", with "AI" in the accent colour), linking home.
 * `isNameHiddenOnPhone` keeps a narrow top bar tidy.
 */
export function BrandLink({ isNameHiddenOnPhone = false }: { isNameHiddenOnPhone?: boolean }) {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5 rounded-lg pr-1">
      <span className="brand-mark" aria-hidden>
        <LogoIcon />
      </span>
      <span
        className={`text-[16px] font-extrabold tracking-[-0.02em] text-ink ${
          isNameHiddenOnPhone ? 'hidden sm:inline' : ''
        }`}
      >
        Nimbrio <span className="highlight">AI</span>
      </span>
    </Link>
  );
}
