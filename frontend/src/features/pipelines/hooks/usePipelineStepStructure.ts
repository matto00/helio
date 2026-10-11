import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { createOutput } from "../services/outputService";
import { createPipelineStep, deletePipelineStep } from "../services/pipelineService";
import { fetchOutputs, previewOutput } from "../state/outputsSlice";
import { fetchPipelineSteps } from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { usePipelineShapeInstantiation } from "./usePipelineShapeInstantiation";
import { usePipelineStepCreation } from "./usePipelineStepCreation";
import type { PendingDraftMeta } from "./usePipelineStepCreation";
import type { useToast } from "../../toasts/hooks/useToast";
import type { Output } from "../types/output";
import type { AggregateConfig, PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

type UsePipelineStepStructureArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  roots: PipelineRoot[];
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  setStepsInitialized: Dispatch<SetStateAction<boolean>>;
  pushToast: ReturnType<typeof useToast>["push"];
  pendingDraftMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
  setPendingDraftIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
  draftFallbackMetaRef: MutableRefObject<Map<string, PendingDraftMeta>>;
};

/**
 * The step-structure handlers extracted from `usePipelineDetailPage` (HEL-1465): the server resync,
 * step creation (`usePipelineStepCreation`), "add as tail with aggregate" and shape instantiation.
 */
export function usePipelineStepStructure({
  id,
  dispatch,
  roots,
  stepsRef,
  setSteps,
  setStepsInitialized,
  pushToast,
  pendingDraftMetaRef,
  setPendingDraftIds,
  draftFallbackMetaRef,
}: UsePipelineStepStructureArgs) {
  // evaluation-2.md CR9 — any create call that passes a `parentStepId` without
  // `attachAsTail` (a trunk splice-insert) can reparent the anchor's OTHER
  // existing children server-side (`spliceInsertAtInternal`); a tail-attach
  // create can't reparent siblings itself, but a later trunk-append past that
  // same anchor can. Patching only the one temp-to-persisted element (the old
  // behavior) leaves every other step's `parentStepId`/`position` in local
  // state stale, so `buildStepTree` — fed stale inputs — renders the wrong
  // tree until a hard reload re-fetches. Refetching the FULL list here after
  // every create keeps local state byte-for-byte what a reload would show
  // (verified live, see execution-progress.md Cycle 3 for HEL-908).
  const syncStepsFromServer = useCallback(async () => {
    if (!id) return;
    const { steps: freshSteps } = await dispatch(fetchPipelineSteps(id)).unwrap();
    // HEL-1321 — carry a draft-created step's stable render key across the full-list replace
    // (matched by real id); every other step is rebuilt exactly as before.
    const renderKeys = new Map<string, string>();
    for (const s of stepsRef.current) if (s.renderKey) renderKeys.set(s.id, s.renderKey);
    setSteps(
      freshSteps.map((ps) => {
        const next = pipelineStepToStep(ps);
        const renderKey = renderKeys.get(next.id);
        return renderKey ? { ...next, renderKey } : next;
      }),
    );
  }, [id, dispatch, stepsRef, setSteps]);

  const {
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep,
    handleAddStep,
    handleAddLaneStep,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
  } = usePipelineStepCreation({
    id,
    roots,
    stepsRef,
    setSteps,
    setStepsInitialized,
    syncStepsFromServer,
    pushToast,
    pendingDraftMetaRef,
    setPendingDraftIds,
    draftFallbackMetaRef,
  });

  // HEL-908 task 5.6 — "Add as tail with aggregate": issues the two calls
  // design.md decision 5 specifies (`POST /pipelines/:id/steps` with kind
  // `aggregate`/`parentStepId`/`attachAsTail: true`, then
  // `POST /pipelines/:id/outputs` with `nodeStepId` = the new step), and
  // rolls the step back if the Output create fails (no orphaned aggregate
  // tail left behind on a failed save). Mirrors `handleAddTailStep`'s local
  // `steps` state update so the new node renders in the river immediately,
  // and refreshes the Outputs list so the rail/gallery pick up the new
  // Output without a full page reload.
  const handleAddOutputViaAggregateTail = useCallback(
    async (
      parentStepId: string,
      aggregateConfig: AggregateConfig,
      outputPayload: { kind: string; name: string; config: Record<string, unknown> },
    ): Promise<Output> => {
      if (!id) throw new Error("Missing pipeline id");
      const persistedStep = await createPipelineStep(
        id,
        "aggregate",
        aggregateConfig,
        undefined,
        parentStepId,
        true,
      );
      // CR9 — resync from the server rather than appending the new step at
      // the end of the local array: appending doesn't place it after its
      // actual anchor, and (symmetrically with `handleInsertStep`/
      // `handleAddTailStep`) any subsequent trunk-append can reparent this
      // tail's siblings, so local state must already be server-fresh.
      await syncStepsFromServer();
      try {
        const output = await createOutput(id, {
          nodeStepId: persistedStep.id,
          kind: outputPayload.kind,
          name: outputPayload.name,
          config: outputPayload.config,
        });
        void dispatch(fetchOutputs({ pipelineId: id }));
        // HEL-908 Cycle 13 -- same staleness gap as the sheet's create path:
        // without this the new tail's rail chip shows no preview until its
        // sheet is opened once.
        void dispatch(previewOutput({ pipelineId: id, outputId: output.id }));
        return output;
      } catch (err: unknown) {
        // Rollback (design.md decision 5): the step was created but the
        // Output failed to save -- delete the orphaned aggregate tail
        // rather than leaving it behind for the caller to notice later.
        setSteps((prev) => prev.filter((s) => s.id !== persistedStep.id));
        void deletePipelineStep(persistedStep.id).catch(() => {});
        throw err;
      }
    },
    [id, dispatch, syncStepsFromServer, setSteps],
  );

  const handleInstantiateShape = usePipelineShapeInstantiation({
    id,
    roots,
    setSteps,
    setStepsInitialized,
    pushToast,
  });

  return {
    syncStepsFromServer,
    draftCreateErrors,
    creatingStepIds,
    handleInsertStep,
    handleAddStep,
    handleAddLaneStep,
    clearDraftCreateError,
    createDraftIfComplete,
    markTempRemoved,
    handleAddOutputViaAggregateTail,
    handleInstantiateShape,
  };
}
