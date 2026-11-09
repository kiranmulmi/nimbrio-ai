import { AlertCircleIcon } from '../../lib/icons';
import type { AuthFix, AuthProblem } from './authErrors';
import { TEXT_LINK } from './authStyles';

const FIX_LABELS: Record<AuthFix, string> = {
  resendConfirmation: 'Resend the confirmation email',
  signIn: 'Sign in instead',
  resetPassword: 'Reset your password',
};

/** Why the last step failed, with a link to the step that gets past it when there is one. */
export function ProblemBox({
  problem,
  onFix,
  isDisabled = false,
}: {
  problem: AuthProblem;
  onFix?: (fix: AuthFix) => void;
  isDisabled?: boolean;
}) {
  const { fix } = problem;
  return (
    <div
      role="alert"
      className="mt-5 flex gap-2.5 border-l-[3px] border-danger-line py-0.5 pl-3 text-[13.5px] leading-relaxed text-ink-2"
    >
      <AlertCircleIcon size={16} className="mt-0.5 shrink-0 text-danger" />
      <p>
        {problem.message}
        {fix && onFix && (
          <>
            {' '}
            <button
              type="button"
              className={TEXT_LINK}
              disabled={isDisabled}
              onClick={() => onFix(fix)}
            >
              {FIX_LABELS[fix]}
            </button>
          </>
        )}
      </p>
    </div>
  );
}
