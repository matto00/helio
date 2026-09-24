// HEL-1096 design.md D3/D4 — builds the ONE toast a dataset write's `deniedPipelines` response
// field pushes. Pure, side-effect-free (mirrors `formSubmission.ts`'s convention) — the caller
// dispatches the result and supplies the actual "Run to update" click behavior.

import type { DeniedPipelineResponse } from "../../sources/types/dataSource";
import type { ToastInput } from "../../toasts/state/toastsSlice";
import { denyReasonCopy } from "./denyReasonCopy";

/** design.md D3: ONE toast per write, never one per denied pipeline — the message aggregates
 *  every denied pipeline's specific-rule sentence(s), one line each. The toast carries a
 *  "Run to update" `action` only when EXACTLY one pipeline was denied AND that pipeline's
 *  `canRun` is true — a toast `action` is a single `{label, onClick}`, so N>1 denied pipelines
 *  has no single well-defined target (D3); for that case the pipeline detail page (D5) is where
 *  each denial is resolved individually.
 *
 *  design.md D4: the message is built deterministically from `(sorted pipelineIds, reasons)` —
 *  no timestamps, no per-request ids — so a burst of writes against an unchanged verdict
 *  produces byte-identical messages, and `toastsSlice`'s own variant+message dedup (already
 *  speced in `toast-surface-behavior`) coalesces them for free. No new debounce/throttle logic
 *  is added here.
 *
 *  Caller MUST guard `deniedPipelines.length === 0` before calling this (design.md D1: an
 *  empty array — every denied pipeline was invisible to the writer — means no toast at all). */
export function buildDeniedPipelinesToast(
  deniedPipelines: DeniedPipelineResponse[],
  onRunToUpdate: () => void,
): ToastInput {
  const sorted = [...deniedPipelines].sort((a, b) => a.pipelineId.localeCompare(b.pipelineId));
  const message = sorted
    .map((p) => `${p.name}: ${p.reasons.map(denyReasonCopy).join(" ")}`)
    .join("\n");

  const single = deniedPipelines.length === 1 ? deniedPipelines[0] : undefined;
  if (single !== undefined && single.canRun) {
    return {
      variant: "warning",
      message,
      duration: 0, // C6 — an action-carrying denial toast must never auto-dismiss.
      action: { label: "Run to update", onClick: onRunToUpdate },
    };
  }
  return { variant: "warning", message };
}
