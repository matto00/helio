import { Check, Circle, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import type { OnboardingStepStatus } from "../state/onboardingSteps";
import { InlineError } from "../../../shared/chrome/InlineError";
import { Skeleton } from "../../../shared/ui/Skeleton";

const STATUS_LABEL: Record<OnboardingStepStatus, string> = {
  complete: "Complete",
  incomplete: "Not started",
  indeterminate: "Checking…",
  failed: "Couldn't check",
};

interface OnboardingStepProps {
  /** This step's section glyph, taken from `shared/chrome/sections.ts` (D8)
   *  — binds the concept to the same icon the nav already uses for it. */
  icon: LucideIcon;
  label: string;
  description: ReactNode;
  status: OnboardingStepStatus;
  /** True for the first step that is not `complete` (design.md D6). */
  emphasized: boolean;
  /** Primary in the placement superseding an empty state, Secondary above a
   *  populated/skeleton grid (design.md D6) — irrelevant when not
   *  `emphasized` (Ghost always wins there). */
  emphasisVariant: "primary" | "secondary";
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  /** The step's own collection error (`sources.error` etc.), rendered only
   *  when `status === "failed"`. */
  collectionError: string | null;
  /** Omitted (not just a no-op) for the dashboard step: `fetchDashboards`'s
   *  own `condition` only permits a dispatch from `"idle"` — unlike its
   *  three siblings, there is no working retry-from-failed path for it
   *  anywhere in the app today (`DashboardList`'s sidebar renders the same
   *  failed state with no retry either), so offering one here would be a
   *  button that silently does nothing rather than an honest omission. */
  onRetry?: () => void;
  retrying?: boolean;
  /** Dashboard-step-only: `useCreateDashboardAction().error`, the shared
   *  instance's own rejection — rendered with the same announced error
   *  treatment the empty state uses (task 2.16). */
  createError?: string | null;
}

/** One row of the onboarding checklist (`OnboardingChecklist`). A completed
 *  step renders a check and no button (D6); an indeterminate one renders a
 *  `Skeleton` in place of the check, not an empty unchecked box, and keeps
 *  its action available (D10, §7); a failed one renders `InlineError`'s
 *  banner+retry instead of the ordinary action button, never as unchecked
 *  (D10). */
export function OnboardingStep({
  icon: Icon,
  label,
  description,
  status,
  emphasized,
  emphasisVariant,
  actionLabel,
  onAction,
  actionDisabled = false,
  collectionError,
  onRetry,
  retrying = false,
  createError = null,
}: OnboardingStepProps) {
  const actionClass = emphasized
    ? `onboarding-checklist__action onboarding-checklist__action--${emphasisVariant}`
    : "onboarding-checklist__action onboarding-checklist__action--ghost";

  return (
    <li className="onboarding-checklist__step" aria-current={emphasized ? "step" : undefined}>
      <span className="onboarding-checklist__step-indicator" aria-hidden="true">
        {status === "complete" ? (
          <Check />
        ) : status === "indeterminate" ? (
          <Skeleton variant="circle" width={20} height={20} />
        ) : status === "failed" ? (
          <TriangleAlert />
        ) : (
          <Circle />
        )}
      </span>
      <div className="onboarding-checklist__step-body">
        <p className="onboarding-checklist__step-title">
          <Icon aria-hidden="true" className="onboarding-checklist__step-icon" />
          {label}
          <span className="sr-only"> — {STATUS_LABEL[status]}</span>
        </p>
        <p className="onboarding-checklist__step-description">{description}</p>
        {createError !== null ? (
          <InlineError variant="banner" kind="error" error={createError} />
        ) : null}
        {status === "failed" ? (
          <InlineError
            variant="banner"
            kind="error"
            error={collectionError}
            onRetry={onRetry}
            retrying={retrying}
          />
        ) : status !== "complete" ? (
          <button
            type="button"
            className={actionClass}
            onClick={onAction}
            disabled={actionDisabled}
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </li>
  );
}
