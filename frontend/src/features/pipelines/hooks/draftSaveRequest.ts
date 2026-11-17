import { isAxiosError } from "axios";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { extractDraftSaveConflict } from "../services/draftSaveService";
import {
  definitionMatchesBase,
  replayOverlay,
  toDraftOutputs,
  toDraftSteps,
} from "../state/pipelineDraft";
import type { DraftOverlay } from "../state/pipelineDraft";
import { isDraftClientId } from "../state/draftOps";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type {
  DraftCascadeConfirmation,
  DraftRunOutcome,
  DraftSaveCascadeRequired,
  DraftSaveRequest,
} from "../types/draftSave";
import type { Output } from "../types/output";
import type { PipelineRoot, PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** What the page tells the user about a draft that is not (yet) saved. At most one at a time. */
export type DraftNotice =
  | { kind: "stale" }
  | { kind: "dropped"; count: number }
  | { kind: "error"; message: string; stepName: string | null }
  | { kind: "undoBlocked"; message: string }
  | { kind: "undoNeedsDiscard"; applicationId: string };

export interface DraftCascadePrompt {
  impact: DraftSaveCascadeRequired["impact"];
  /** Names for the ids the server listed, resolved from the page's steps and Outputs. */
  stepNames: string[];
  outputNames: string[];
}

export function runRefusedMessage(run: Extract<DraftRunOutcome, { started: false }>): string {
  const why = run.code === 429 ? "rate limit" : run.reason;
  const retry = run.retryAfterSeconds !== undefined ? `, retry in ${run.retryAfterSeconds} s` : "";
  return `Saved. Run not started: ${why}${retry}`;
}

/** The step the server named in a 400, if its message mentions one of the page's step ids. */
export function stepNamedBy(
  message: string,
  steps: readonly Step[],
  outputs: readonly Output[] = [],
): string | null {
  const hit = steps.find((s) => message.includes(s.id));
  if (hit) return hit.label;
  // A created Output is named by its client id in a 400 (HEL-1733 D9).
  const out = outputs.find((o) => isDraftClientId(o.id) && message.includes(o.id));
  return out ? out.name : null;
}

export type DraftSaveBuild =
  | { kind: "unreadable" }
  | { kind: "stale" }
  | { kind: "dropped"; count: number }
  | { kind: "ready"; request: DraftSaveRequest };

/**
 * Checks the draft's base against the freshly read saved definition and replays the overlay over it. If any op no longer applies
 * nothing is sent (`dropped`), never a reduced tree.
 */
export function buildDraftSaveRequest(args: {
  summary: {
    fingerprint?: string;
    definition?: { steps: PipelineStep[]; outputs: Output[] };
  };
  persistedSteps: Step[];
  baseOutputs: Output[] | null;
  overlay: DraftOverlay;
  roots: PipelineRoot[];
  confirm: DraftCascadeConfirmation | undefined;
}): DraftSaveBuild {
  const { summary, persistedSteps, baseOutputs, overlay, roots, confirm } = args;
  const definition = summary.definition;
  if (!definition || summary.fingerprint === undefined) return { kind: "unreadable" };
  const savedSteps = definition.steps.map(pipelineStepToStep);
  if (
    !definitionMatchesBase(
      { steps: savedSteps, outputs: definition.outputs },
      persistedSteps,
      baseOutputs,
    )
  ) {
    return { kind: "stale" };
  }
  const replay = replayOverlay(savedSteps, overlay, definition.outputs);
  if (replay.dropped > 0) return { kind: "dropped", count: replay.dropped };
  const finalSteps = replay.steps;
  return {
    kind: "ready",
    request: {
      baseFingerprint: summary.fingerprint,
      steps: toDraftSteps(finalSteps),
      outputs: toDraftOutputs(replay.outputs ?? definition.outputs, finalSteps, roots[0]?.id),
      runAfterSave: "run",
      ...(confirm ? { confirmCascade: confirm } : {}),
    },
  };
}

/** Maps a failed save to the cascade prompt (a 422) or the notice to show. */
export function noticeForSaveError(
  err: unknown,
  ctx: {
    steps: readonly Step[];
    outputs: readonly Output[];
    draftSteps: readonly Step[];
    draftOutputs?: readonly Output[];
  },
): { cascade: DraftCascadePrompt } | { notice: DraftNotice } {
  const conflict = extractDraftSaveConflict(err);
  if (conflict?.kind === "stale") return { notice: { kind: "stale" } };
  if (conflict?.kind === "cascadeRequired") {
    const stepName = new Map(ctx.steps.map((s) => [s.id, s.label]));
    const outputName = new Map(ctx.outputs.map((o) => [o.id, o.name]));
    return {
      cascade: {
        impact: conflict.impact,
        stepNames: conflict.impact.stepIds.map((s) => stepName.get(s) ?? "A step"),
        outputNames: conflict.impact.outputIds.map((o) => outputName.get(o) ?? "An Output"),
      },
    };
  }
  const message = extractErrorMessage(
    err,
    isAxiosError(err) ? "The save was refused." : "The save could not be completed.",
  );
  return {
    notice: {
      kind: "error",
      message,
      stepName: stepNamedBy(message, ctx.draftSteps, ctx.draftOutputs),
    },
  };
}
