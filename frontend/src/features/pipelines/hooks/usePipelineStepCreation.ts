import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createPipelineStep } from "../services/pipelineService";
import type { CreatedPipelineStep } from "../services/pipelineService";
import { applyCreatedStep } from "../state/applyCreatedStep";
import { computeInsertAnchor, insertWireArgs } from "../state/insertAnchor";
import type { InsertAnchor } from "../state/insertAnchor";
import {
  defaultConfigFor,
  makeStep,
  requiresCompleteConfigForCreate,
} from "../state/stepNarrowing";
import type { PipelineRoot, PipelineStepKind } from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import type { useToast } from "../../toasts/hooks/useToast";
import { usePipelineDraftCreate } from "./usePipelineDraftCreate";
import { usePipelineLaneStepCreation } from "./usePipelineLaneStepCreation";

/** Metadata for a deferred (draft) create, keyed by the draft's temp id in the page hook's ref. */
export type PendingDraftMeta = {
  // HEL-1345 D11 — a gap insert's anchor (a persisted step id, or the root head), resolved at
  // click time; `undefined` is the bottom-row append. NOT `parentStepId` below, which is the LANE
  // draft's anchor and is read by `getDraftFallbackSchema`.
  anchor?: InsertAnchor;
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
  // Created by the page hook, which mirrors its key set into `pendingDraftIds` state (via
  // `setPendingDraftIds`, called after every mutation of the ref, here and in
  // `usePipelineLaneStepCreation` / `usePipelineDraftCreate`) for `stepsFingerprint`.
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  setPendingDraftIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  // HEL-1340 — sent drafts' anchor meta for the schema fallback (see the page hook).
  draftFallbackMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
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
  pushToast,
  pendingDraftMetaRef,
  setPendingDraftIds,
  draftFallbackMetaRef,
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

  // HEL-1345 D5 — reparents a create's response reports for steps not present locally yet (their
  // own create has not responded): reparented id -> the created id that took it.
  const pendingParentRef = useRef(new Map<string, string>());
  // Temp ids the user removed while their create may still be in flight (an orphaned server step
  // must not be re-added when its response lands).
  const userRemovedTempIdsRef = useRef(new Set<string>());
  const markTempRemoved = useCallback((tempId: string) => {
    userRemovedTempIdsRef.current.add(tempId);
  }, []);

  /** Apply a create response's delta (see `applyCreatedStep`). `renderKey` is set for drafts only. */
  const applyCreated = useCallback(
    (tempId: string, created: CreatedPipelineStep, renderKey?: string) => {
      // Read + delete the claim OUTSIDE the updater so the updater stays idempotent (StrictMode).
      const claimedParent = pendingParentRef.current.get(created.id);
      pendingParentRef.current.delete(created.id);
      const reparented = created.reparentedStepIds ?? [];
      setSteps((prev) =>
        applyCreatedStep(prev, tempId, created, reparented, {
          renderKey,
          claimedParent,
          pendingParent: pendingParentRef.current,
          userRemoved: userRemovedTempIdsRef.current,
        }),
      );
    },
    [setSteps],
  );

  // HEL-1478 -- publishes `pendingDraftMetaRef`'s current key set to the page hook's state. Called
  // right after every mutation of the ref, each of which sits in the same synchronous batch as a
  // setState that already re-renders the page (`setSteps` / `setDraftCreateErrors`).
  const syncPendingDraftIds = useCallback(() => {
    setPendingDraftIds(new Set(pendingDraftMetaRef.current.keys()));
  }, [setPendingDraftIds, pendingDraftMetaRef]);

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
      // HEL-1345 D11 — resolve the anchor from the lane the river rendered, BEFORE the optimistic
      // splice below changes `stepsRef`. The wire call is built from it when the create is sent.
      const anchor = isAppend ? undefined : computeInsertAnchor(stepsRef.current, roots, index);
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
          anchor,
          rootId: roots[0]?.id,
        });
        syncPendingDraftIds();
        return;
      }
      markCreating(tempStep.id, true);
      try {
        const initialConfig = defaultConfigFor(opType.id);
        // HEL-968: this handler only ever inserts into root 0's own top-level lane (every other
        // root renders read-only-ish via `RootColumn`, task 6) -- `rootId` is required once the
        // pipeline has more than one root (R6/task 2.3).
        const wire = insertWireArgs(
          anchor,
          (stepId) => stepsRef.current.some((s) => s.id === stepId),
          roots[0]?.id,
        );
        const created = await createPipelineStep(
          id,
          opType.id as PipelineStepKind,
          initialConfig,
          wire.position,
          wire.parentStepId,
          undefined,
          wire.rootId,
        );
        // CR9 / HEL-1345 D5 — a splice-insert can reparent OTHER existing steps server-side. Apply
        // the response's reported delta instead of a wholesale resync, which would drop local-only
        // drafts and overwrite a card's local config.
        applyCreated(tempStep.id, created);
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
      roots,
      markCreating,
      applyCreated,
      stepsRef,
      setSteps,
      setStepsInitialized,
      pendingDraftMetaRef,
      syncPendingDraftIds,
    ],
  );

  const handleAddStep = useCallback(
    (opType: OpType) => {
      void handleInsertStep(opType, stepsRef.current.length);
    },
    [handleInsertStep, stepsRef],
  );

  const handleAddLaneStep = usePipelineLaneStepCreation({
    id,
    pushToast,
    markCreating,
    applyCreated,
    stepsRef,
    setSteps,
    setStepsInitialized,
    pendingDraftMetaRef,
    syncPendingDraftIds,
  });

  const createDraftIfComplete = usePipelineDraftCreate({
    id,
    stepsRef,
    applyCreated,
    pendingDraftMetaRef,
    draftFallbackMetaRef,
    syncPendingDraftIds,
    creatingDraftIdsRef,
    setDraftCreateErrors,
  });

  return {
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep,
    handleAddStep,
    handleAddLaneStep,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
    applyCreated,
  };
}
