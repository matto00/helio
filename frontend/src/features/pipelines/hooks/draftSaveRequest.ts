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
import { hasRootChange, replayRoots, toDraftRoots } from "../state/draftRoots";
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
  /** HEL-1734: the sources the draft removes. */
  rootNames: string[];
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

/** Whether two root lists are the same roots on the same sources in the same order. */
function sameRoots(a: readonly PipelineRoot[], b: readonly PipelineRoot[]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.id === b[i].id && r.dataSourceId === b[i].dataSourceId)
  );
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
    roots?: PipelineRoot[];
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
  // HEL-1734: the roots are part of the base too. A pipeline whose roots changed since the draft was made (another tab, an
  // assistant) is stale, never saved over, exactly as for steps and Outputs.
  if (summary.roots !== undefined && !sameRoots(summary.roots, roots)) return { kind: "stale" };
  const replay = replayOverlay(savedSteps, overlay, definition.outputs);
  // HEL-1734: the roots as the freshly read pipeline has them; a root op that cannot apply to them is dropped and counted, and
  // nothing is sent. A step still naming a root the draft removed (or never had) is the same kind of loss.
  const savedRoots = summary.roots ?? roots;
  const rootReplay = replayRoots(savedRoots, overlay.ops);
  const rootDropped = rootReplay.droppedOps.filter((op) => !replay.droppedOps.includes(op)).length;
  const finalRootIds = new Set(rootReplay.roots.map((r) => r.id));
  const orphaned = hasRootChange(overlay.ops)
    ? replay.steps.filter((s) => !s.parentStepId && s.rootId != null && !finalRootIds.has(s.rootId))
        .length
    : 0;
  if (replay.dropped + rootDropped + orphaned > 0)
    return { kind: "dropped", count: replay.dropped + rootDropped + orphaned };
  const finalSteps = replay.steps;
  const draftRoots = toDraftRoots(overlay.ops, rootReplay.roots);
  return {
    kind: "ready",
    request: {
      baseFingerprint: summary.fingerprint,
      steps: toDraftSteps(finalSteps),
      outputs: toDraftOutputs(
        replay.outputs ?? definition.outputs,
        finalSteps,
        rootReplay.roots[0]?.id ?? roots[0]?.id,
      ),
      ...(draftRoots ? { roots: draftRoots } : {}),
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
    /** The saved roots, for naming the sources a removal lists (HEL-1734). */
    roots?: readonly PipelineRoot[];
  },
): { cascade: DraftCascadePrompt } | { notice: DraftNotice } {
  const conflict = extractDraftSaveConflict(err);
  if (conflict?.kind === "stale") return { notice: { kind: "stale" } };
  if (conflict?.kind === "cascadeRequired") {
    const stepName = new Map(ctx.steps.map((s) => [s.id, s.label]));
    const outputName = new Map(ctx.outputs.map((o) => [o.id, o.name]));
    const rootName = new Map((ctx.roots ?? []).map((r) => [r.id, r.dataSourceName]));
    return {
      cascade: {
        impact: conflict.impact,
        stepNames: conflict.impact.stepIds.map((s) => stepName.get(s) ?? "A step"),
        outputNames: conflict.impact.outputIds.map((o) => outputName.get(o) ?? "An Output"),
        rootNames: conflict.impact.rootIds.map((r) => rootName.get(r) ?? "A source"),
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
