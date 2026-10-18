import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createPipelineStep } from "../services/pipelineService";
import type { CreatedPipelineStep } from "../services/pipelineService";
import {
  defaultConfigFor,
  makeStep,
  requiresCompleteConfigForCreate,
} from "../state/stepNarrowing";
import type { PipelineStepKind } from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import type { useToast } from "../../toasts/hooks/useToast";
import type { PendingDraftMeta } from "./usePipelineStepCreation";

type UsePipelineLaneStepCreationArgs = {
  id: string | undefined;
  pushToast: ReturnType<typeof useToast>["push"];
  markCreating: (tempId: string, creating: boolean) => void;
  /** Shows a failed create's message inline on the kept temp step (HEL-1582: the phone's step sheet is a modal
   *  dialog, which covers the toast viewport). */
  recordCreateError: (tempId: string, message: string) => void;
  applyCreated: (tempId: string, created: CreatedPipelineStep, renderKey?: string) => void;
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  setStepsInitialized: Dispatch<SetStateAction<boolean>>;
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  syncPendingDraftIds: () => void;
};

/** The "+ lane" step create (`handleAddLaneStep`), extracted from `usePipelineStepCreation` (HEL-1481). */
export function usePipelineLaneStepCreation({
  id,
  pushToast,
  markCreating,
  recordCreateError,
  applyCreated,
  stepsRef,
  setSteps,
  setStepsInitialized,
  pendingDraftMetaRef,
  syncPendingDraftIds,
}: UsePipelineLaneStepCreationArgs) {
  // HEL-912 task 4.2 — "+ lane" create affordance (generalizes HEL-908's
  // "+ tail"): every step gets this affordance UNCONDITIONALLY now (design.md
  // Decision 1 removed the single-tail-per-node invariant this used to be
  // gated on — a node with several children just roots several lanes).
  // Still passes `attachAsTail = true` so the backend's `attachTailInternal`
  // primitive attaches this as a genuine NEW sibling (no reparenting of the
  // anchor's other children) — the same wire call HEL-908 built, just no
  // longer gated by `hasTail`.
  const handleAddLaneStep = useCallback(
    async (opType: OpType, parentStepId: string) => {
      if (!id) return;
      setStepsInitialized(true);
      const baseStep = makeStep(opType, parentStepId);
      // HEL-1321 D2b — a draft (only) gets a provisional non-zero `position` so
      // `buildLaneGraph` renders it as the head of its OWN lane from the first render (a sole
      // position-less child would render inside the anchor's lane, then hop to a new
      // `LaneColumn` once the server assigns position >= 1). Mirrors the server's
      // `attachTail` rule (max sibling position + 1). Never sent: the create passes
      // `attachAsTail`, not a position. The create-immediately branch keeps the plain step.
      const tempStep = requiresCompleteConfigForCreate(opType.id)
        ? {
            ...baseStep,
            position:
              stepsRef.current
                .filter((s) => s.parentStepId === parentStepId)
                .reduce((max, s) => Math.max(max, s.position ?? 0), 0) + 1,
          }
        : baseStep;
      // Must land IMMEDIATELY after the anchor in the flat array —
      // `buildLaneGraph` derives lane membership from `parentStepId` and
      // `position`, not array order, but `executionOrder` still emits a
      // node's child-lanes directly after it, so this keeps optimistic
      // local state byte-shaped like what a resync would return.
      const anchorIndex = stepsRef.current.findIndex((s) => s.id === parentStepId);
      const insertIndex = anchorIndex === -1 ? stepsRef.current.length : anchorIndex + 1;
      setSteps((prev) => {
        const next = [...prev];
        next.splice(insertIndex, 0, tempStep);
        return next;
      });
      // design.md D3 — same deferred-create rule as `handleInsertStep` in `usePipelineStepCreation.ts`.
      if (requiresCompleteConfigForCreate(opType.id)) {
        // evaluation-1.md CR2(c) — carries the anchor's own `rootId` through
        // so `getDraftFallbackSchema`'s last-resort root-source fallback
        // (reached only if the anchor itself has no analyze entry yet)
        // matches the correct root on a multi-root pipeline, not always
        // `sourceSchemas[0]`.
        const anchorStep = stepsRef.current.find((s) => s.id === parentStepId);
        pendingDraftMetaRef.current.set(tempStep.id, {
          parentStepId,
          attachAsTail: true,
          rootId: anchorStep?.rootId,
        });
        syncPendingDraftIds();
        return;
      }
      markCreating(tempStep.id, true);
      try {
        const initialConfig = defaultConfigFor(opType.id);
        const created = await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          undefined,
          parentStepId,
          true,
        );
        // HEL-1345 D5 — a tail attach reports no reparented ids; this swaps the temp for the
        // persisted step in place (the wholesale resync it replaces would drop local-only drafts).
        applyCreated(tempStep.id, created);
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to add lane step.");
        pushToast({
          variant: "error",
          message: `Failed to add ${opType.label.toLowerCase()} lane: ${message}`,
        });
        recordCreateError(tempStep.id, message);
      } finally {
        markCreating(tempStep.id, false);
      }
    },
    [
      id,
      pushToast,
      markCreating,
      recordCreateError,
      applyCreated,
      stepsRef,
      setSteps,
      setStepsInitialized,
      pendingDraftMetaRef,
      syncPendingDraftIds,
    ],
  );

  return handleAddLaneStep;
}
