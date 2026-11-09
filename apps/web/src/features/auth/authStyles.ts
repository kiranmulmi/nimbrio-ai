// The sign-in screens' larger controls, shared by LoginPage and SetPasswordPage.
const BIG_BUTTON =
  'inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border text-[14px] font-semibold transition-[background-color,border-color,transform] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
export const PRIMARY_BUTTON = `${BIG_BUTTON} border-transparent bg-accent text-on-accent shadow-accent hover:bg-accent-hover enabled:hover:-translate-y-px`;
export const OUTLINE_BUTTON = `${BIG_BUTTON} border-line bg-surface text-ink hover:border-line-strong hover:bg-subtle`;
export const TEXT_LINK =
  'font-semibold text-accent-2 hover:underline focus-visible:underline focus-visible:outline-none';
