import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createPipelineStep, updatePipelineStep } from "../services/pipelineService";
import {
  defaultConfigFor,
  isCompleteAiStepConfig,
  makeStep,
  pipelineStepToStep,
  requiresCompleteConfigForCreate,
} from "../state/stepNarrowing";
import type { PipelineRoot, PipelineStepConfig, PipelineStepKind } from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import type { useToast } from "../../toasts/hooks/useToast";

/** Metadata for a deferred (draft) create, keyed by the draft's temp id in the page hook's ref. */
export type PendingDraftMeta = {
  index?: number;
  parentStepId?: string;
  attachAsTail?: boolean;
  rootId?: string;
};

type UsePipelineStepCreationArgs = {
  id: string | undefined;
  roots: readonly PipelineRoot[];
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  setStepsInitialized: Dispatch<SetStateAction<boolean>>;
  syncStepsFromServer: () => Promise<void>;
  pushToast: ReturnType<typeof useToast>["push"];
  // Created by the page hook because `stepsFingerprint` reads it during render.
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
};

/**
 * Step-create and draft-create logic extracted from `usePipelineDetailPage` (HEL-1340): the
 * create-immediately insert/append/lane paths, HEL-1294's in-flight `creatingStepIds`, and the
 * HEL-1109/HEL-1321 deferred draft create.
 */
export function usePipelineStepCreation({
  id,
  roots,
  stepsRef,
  setSteps,
  setStepsInitialized,
  syncStepsFromServer,
  pushToast,
  pendingDraftMetaRef,
}: UsePipelineStepCreationArgs) {
  // Guards against firing a second create for the same draft while the
  // first is still in flight (a burst of edits can call
  // `handleStepConfigChange` several times before the create resolves).
  const creatingDraftIdsRef = useRef(new Set<string>());
  // HEL-1109 (pipeline-ai-step-authoring spec) — a rejected create's message,
  // surfaced inline on the draft's own card rather than swallowed; cleared
  // once the draft either creates successfully or is edited again.
  const [draftCreateErrors, setDraftCreateErrors] = useState<Record<string, string>>({});
  // HEL-1294 — temp ids whose optimistic create (POST + resync) is in flight. The resync replaces
  // the temp step with the persisted one under a new id, which remounts the keyed card collapsed;
  // a card in this set therefore cannot be expanded (StepCard `isCreating`). Cleared in a `finally`
  // so a failed create re-enables the toggle (its kept local step still needs Remove).
  const [creatingStepIds, setCreatingStepIds] = useState<ReadonlySet<string>>(() => new Set());
  const markCreating = useCallback((tempId: string, creating: boolean) => {
    setCreatingStepIds((prev) => {
      if (creating === prev.has(tempId)) return prev;
      const next = new Set(prev);
      if (creating) next.add(tempId);
      else next.delete(tempId);
      return next;
    });
  }, []);

  const clearDraftCreateError = useCallback((stepId: string) => {
    setDraftCreateErrors((prev) => {
      if (!(stepId in prev)) return prev;
      const next = { ...prev };
      delete next[stepId];
      return next;
    });
  }, []);

  // HEL-410 — generalizes the former `handleAddStep` to insert at any list
  // index (0 = before the first step): optimistic splice at `index` → create
  // with `position` → reconcile the temp step in place on success → keep the
  // temp + toast on failure (the existing append-failure convention,
  // unchanged). `index === steps.length` at call time is exactly the append
  // case (the gap affordance below never offers an index that high — its
  // last gap sits before the final step, not after it), so `position` is
  // omitted from the network call there and the wire payload stays
  // byte-identical to the pre-HEL-410 append request (design.md Decision 6).
  // `isAppend` and `index` are both read from the same closure snapshot,
  // synchronously before the `await` below, so there is no risk of the
  // append check disagreeing with the index that was actually spliced in.
  const handleInsertStep = useCallback(
    async (opType: OpType, index: number) => {
      if (!id) return;
      setStepsInitialized(true);
      const tempStep = makeStep(opType);
      const isAppend = index >= stepsRef.current.length;
      setSteps((prev) => {
        const next = [...prev];
        next.splice(index, 0, tempStep);
        return next;
      });
      // design.md D3 / pipeline-ai-step-authoring spec — a kind whose write-path
      // validator rejects an incomplete config is never POSTed with its
      // known-invalid seed. It stays a local-only draft (no create request at
      // all) until `handleStepConfigChange` sees its config become complete.
      if (requiresCompleteConfigForCreate(opType.id)) {
        pendingDraftMetaRef.current.set(tempStep.id, {
          index: isAppend ? undefined : index,
          rootId: roots[0]?.id,
        });
        return;
      }
      markCreating(tempStep.id, true);
      try {
        const initialConfig = defaultConfigFor(opType.id);
        await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          isAppend ? undefined : index,
          undefined,
          undefined,
          // HEL-968: this handler only ever inserts into root 0's own top-level
          // lane (every other root renders read-only-ish via `RootColumn`, task 6) --
          // required once the pipeline has more than one root (R6/task 2.3).
          roots[0]?.id,
        );
        // CR9 — a trunk splice-insert (this call, when not appending) can
        // reparent OTHER existing steps server-side; resync the whole list
        // rather than patching just this one element.
        await syncStepsFromServer();
      } catch (err: unknown) {
        // Keep temp step if POST fails; PATCH calls will be no-ops until ID is real.
        // Surface the failure — a silent catch here previously let a step creation
        // 404 vanish with no user feedback (evaluation-1.md change request 3).
        const message = extractErrorMessage(err, "Failed to add step.");
        pushToast({
          variant: "error",
          message: `Failed to add ${opType.label.toLowerCase()} step: ${message}`,
        });
      } finally {
        markCreating(tempStep.id, false);
      }
    },
    [
      id,
      pushToast,
      syncStepsFromServer,
      roots,
      markCreating,
      stepsRef,
      setSteps,
      setStepsInitialized,
      pendingDraftMetaRef,
    ],
  );

  const handleAddStep = useCallback(
    (opType: OpType) => {
      void handleInsertStep(opType, stepsRef.current.length);
    },
    [handleInsertStep, stepsRef],
  );

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
      // design.md D3 — same deferred-create rule as `handleInsertStep` above.
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
        return;
      }
      markCreating(tempStep.id, true);
      try {
        const initialConfig = defaultConfigFor(opType.id);
        await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          undefined,
          parentStepId,
          true,
        );
        // CR9 — a tail-attach itself never reparents siblings, but keeping
        // this handler symmetric with `handleInsertStep`'s resync means a
        // SUBSEQUENT trunk-append (which CAN reparent this tail's anchor)
        // always starts from server-fresh local state, not a value stale
        // since whichever earlier create last did a one-element patch.
        await syncStepsFromServer();
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to add lane step.");
        pushToast({
          variant: "error",
          message: `Failed to add ${opType.label.toLowerCase()} lane: ${message}`,
        });
      } finally {
        markCreating(tempStep.id, false);
      }
    },
    [
      id,
      pushToast,
      syncStepsFromServer,
      markCreating,
      stepsRef,
      setSteps,
      setStepsInitialized,
      pendingDraftMetaRef,
    ],
  );

  // HEL-1109 (design.md D3) — a draft AI step (still carrying its makeStep-minted temp id) whose
  // LOCAL config has just become complete is created exactly once, here, rather than at add-time.
  const createDraftIfComplete = useCallback(
    (stepId: string, config: PipelineStepConfig) => {
      const meta = pendingDraftMetaRef.current.get(stepId);
      if (!meta) return;
      const step = stepsRef.current.find((s) => s.id === stepId);
      if (!step || !requiresCompleteConfigForCreate(step.opType.id)) return;
      if (!isCompleteAiStepConfig(step.opType.id, config)) return;
      if (creatingDraftIdsRef.current.has(stepId)) return;
      if (!id) return;
      creatingDraftIdsRef.current.add(stepId);
      pendingDraftMetaRef.current.delete(stepId);
      void createPipelineStep(
        id,
        step.opType.id as PipelineStepKind,
        config,
        meta.index,
        meta.parentStepId,
        meta.attachAsTail,
        meta.rootId,
      )
        .then((persisted) => {
          // HEL-1321 D3 — `stepsRef` still holds the PRE-swap list here, so look the draft up by
          // its temp id. Every edit replaces `config` with a new object, so reference
          // inequality with the POSTed config means the user edited while the create was in
          // flight; that edit was never sent (the create carried the older config, and a
          // temp-id PATCH is skipped), so flush it to the persisted id once.
          const latest = stepsRef.current.find((s) => s.id === stepId);
          const editedInFlight = latest !== undefined && latest.config !== config;
          // HEL-1321 D2 — the temp id becomes the stable render key (set once), so the open
          // card and its lane are not remounted by the id swap.
          setSteps((prev) =>
            prev.map((s) =>
              s.id === stepId
                ? {
                    ...pipelineStepToStep(persisted),
                    config: s.config,
                    renderKey: s.renderKey ?? s.id,
                  }
                : s,
            ),
          );
          if (editedInFlight) {
            updatePipelineStep(persisted.id, latest.config).catch((err: unknown) => {
              const message = extractErrorMessage(
                err,
                "Failed to save your latest edit — try editing again.",
              );
              setDraftCreateErrors((prev) => ({ ...prev, [persisted.id]: message }));
            });
          }
        })
        .catch((err: unknown) => {
          const message = extractErrorMessage(err, "Failed to save this step — try again.");
          setDraftCreateErrors((prev) => ({ ...prev, [stepId]: message }));
          // Restore the pending meta so a subsequent completing edit retries the create.
          pendingDraftMetaRef.current.set(stepId, meta);
        })
        .finally(() => {
          creatingDraftIdsRef.current.delete(stepId);
        });
    },
    [id, stepsRef, setSteps, pendingDraftMetaRef],
  );

  return {
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep,
    handleAddStep,
    handleAddLaneStep,
    clearDraftCreateError,
    createDraftIfComplete,
  };
}
