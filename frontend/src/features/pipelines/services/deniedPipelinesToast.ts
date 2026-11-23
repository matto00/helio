// HEL-1096 design.md D3/D4 — builds the ONE toast a dataset write's `deniedPipelines` response
// field pushes. Pure, side-effect-free (mirrors `formSubmission.ts`'s convention) — the caller
// dispatches the result and supplies the actual "Run to update" click behavior.

import type { DeniedPipelineResponse } from "../../sources/types/dataSource";
import type { ToastInput } from "../../toasts/state/toastsSlice";
import { denyReasonCopy } from "./denyReasonCopy";

/** design.md D3: ONE toast per write, never one per denied pipeline — the message aggregates
 *  every denied pipeline's specific-rule sentence(s), one line each, and stays the coalescing key
 *  and live-region text.
 *
 *  Exactly one denied pipeline: unchanged — a toast-level "Run to update" `action` only when its
 *  `canRun` is true. Two or more (HEL-1172 D3): a persistent toast with one row per pipeline
 *  (sorted by id, like the message): the name links to `/pipelines/<id>` and the row carries its own
 *  "Run to update" only where `canRun`. `onRunToUpdate` receives the id of the pipeline to run.
 *
 *  design.md D4: the message is built deterministically from `(sorted pipelineIds, reasons)` —
 *  no timestamps, no per-request ids — so a burst of writes against an unchanged verdict
 *  produces byte-identical messages, and `toastsSlice`'s own variant+message dedup coalesces them.
 *
 *  Caller MUST guard `deniedPipelines.length === 0` before calling this (design.md D1: an
 *  empty array — every denied pipeline was invisible to the writer — means no toast at all). */
export function buildDeniedPipelinesToast(
  deniedPipelines: DeniedPipelineResponse[],
  onRunToUpdate: (pipelineId: string) => void,
): ToastInput {
  const sorted = [...deniedPipelines].sort((a, b) => a.pipelineId.localeCompare(b.pipelineId));
  const reasonText = (p: DeniedPipelineResponse) => p.reasons.map(denyReasonCopy).join(" ");
  const message = sorted.map((p) => `${p.name}: ${reasonText(p)}`).join("\n");

  if (sorted.length >= 2) {
    return {
      variant: "warning",
      message,
      duration: 0, // every row holds a link, so the toast never auto-dismisses.
      items: sorted.map((p) => ({
        key: p.pipelineId,
        linkLabel: p.name,
        linkTo: `/pipelines/${encodeURIComponent(p.pipelineId)}`,
        text: reasonText(p),
        action: p.canRun
          ? { label: "Run to update", onClick: () => onRunToUpdate(p.pipelineId) }
          : undefined,
      })),
    };
  }

  const single = sorted[0];
  if (single !== undefined && single.canRun) {
    return {
      variant: "warning",
      message,
      duration: 0, // C6 — an action-carrying denial toast must never auto-dismiss.
      action: { label: "Run to update", onClick: () => onRunToUpdate(single.pipelineId) },
    };
  }
  return { variant: "warning", message };
}
