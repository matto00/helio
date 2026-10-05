import { isAxiosError } from "axios";

import { extractErrorMessage } from "../../../services/extractErrorMessage";

/** HEL-1147 — the structured 422 body for a pipeline execution refused because a step's own
 *  configuration is missing or invalid. `message` (the generic, step-id/path-prefixed text) stays
 *  on the body for every existing reader; `reason` is the clean problem description. */
export interface StepConfigError {
  stepId: string;
  stepKind: string;
  reason: string;
}

/** Narrow typed guard over a failed request's body; null for every other failure. */
export function extractStepConfigError(err: unknown): StepConfigError | null {
  if (!isAxiosError(err)) return null;
  const data = err.response?.data as Record<string, unknown> | undefined;
  if (
    data?.code === "STEP_CONFIG_INVALID" &&
    typeof data.stepId === "string" &&
    typeof data.stepKind === "string" &&
    typeof data.reason === "string" &&
    data.reason
  ) {
    return { stepId: data.stepId, stepKind: data.stepKind, reason: data.reason };
  }
  return null;
}

/** The user-facing text for a failed preview. A step-configuration failure shows the clean
 *  `reason`; when the failing step is not `ownStepId` (an ancestor in the executed closure) it is
 *  attributed to that upstream step's kind. Anything else keeps `extractErrorMessage`'s rendering. */
export function previewErrorMessage(err: unknown, fallback: string, ownStepId?: string): string {
  const config = extractStepConfigError(err);
  if (!config) return extractErrorMessage(err, fallback);
  if (ownStepId !== undefined && config.stepId !== ownStepId) {
    return `Upstream ${config.stepKind} step is not fully configured: ${config.reason}`;
  }
  return config.reason;
}
