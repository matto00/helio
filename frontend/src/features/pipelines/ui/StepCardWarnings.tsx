// StepCardWarnings — the expanded card's "Check before running" region (HEL-1414), split out of
// StepCard.tsx (HEL-1465). Calls no hooks: `StepCard` owns the heading id (`useId`) and the
// `expanded && warningCount > 0` guard, so its own hook sequence is unchanged.

import { TriangleAlert } from "lucide-react";

import { ICON_SIZE } from "../../../shared/ui/iconSize";
import type { AnalyzeWarning } from "../types/pipelineStep";

interface StepCardWarningsProps {
  warnings?: AnalyzeWarning[];
  warningsHeadingId: string;
}

export function StepCardWarnings({ warnings, warningsHeadingId }: StepCardWarningsProps) {
  return (
    <div
      className="pipeline-detail-page__step-card-warnings"
      role="region"
      aria-labelledby={warningsHeadingId}
    >
      <p id={warningsHeadingId} className="pipeline-detail-page__step-card-warnings-heading">
        <TriangleAlert aria-hidden="true" size={ICON_SIZE.sm} />
        Check before running{" "}
        <span className="pipeline-detail-page__step-card-warnings-note">
          (these don&apos;t block runs)
        </span>
      </p>
      <ul className="pipeline-detail-page__step-card-warnings-list">
        {warnings?.map((w, i) => (
          <li key={`${w.code}-${i}`}>{w.message}</li>
        ))}
      </ul>
    </div>
  );
}
