// HEL-1096 design.md D7 — the shared "Run to update" click handler both the denial toast and
// the pipeline detail page's denial block submit through. Calls the EXISTING guarded submit
// service function (`runPipeline`, `POST /api/pipelines/:id/run` — the same path every other
// manual run uses, `PipelineRunService.submit`'s own owner-or-editor authorization and HEL-505
// rate-limit/concurrency guards apply unmodified) and branches ONLY on whether the rejection was
// a guard rejection (HTTP 429) or anything else — a 429 gets its own distinct message, naming
// that the run was rate/concurrency-limited, NEVER routed through the deny-reason copy mapping
// (`denyReasonCopy.ts`, keyed on `CostReason.code` — a completely different error channel: the
// gate that denied auto-run is not the guard that denies a manual run).
//
// A successful run needs no explicit panel-refresh call here — HEL-1094/1168's SSE fan-out
// (`features/panels/services/pipelineRunFanout.ts`) is a per-pipeline subscription independent
// of whoever/wherever triggered the run, so any panel bound to this pipeline's Output refreshes
// on its own once the run reaches `succeeded`.

import { isAxiosError } from "axios";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { runPipeline } from "./pipelineService";

export interface RunToUpdateResult {
  ok: boolean;
  message: string;
}

/** Reads the `Retry-After` response header (axios normalizes header names to lowercase) and
 *  renders the guard-rejection message with it when present/parseable — falls back to a message
 *  with no specific wait time otherwise, never throwing on a malformed/missing header. */
function guardRejectionMessage(retryAfterRaw: unknown): string {
  const seconds = typeof retryAfterRaw === "string" ? Number(retryAfterRaw) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return `Too many runs right now — try again in ${seconds}s.`;
  }
  return "Too many runs right now — try again shortly.";
}

/** Submits a real (non-dry) run of `pipelineId` and reports the outcome — never throws. */
export async function runToUpdate(pipelineId: string): Promise<RunToUpdateResult> {
  try {
    await runPipeline(pipelineId);
    return { ok: true, message: "Run started." };
  } catch (err) {
    if (isAxiosError(err) && err.response?.status === 429) {
      return { ok: false, message: guardRejectionMessage(err.response.headers?.["retry-after"]) };
    }
    return {
      ok: false,
      message: extractErrorMessage(err, "The run could not be started. Please try again."),
    };
  }
}
