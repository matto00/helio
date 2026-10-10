import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { createOutput } from "../services/outputService";
import { createPipelineStep, deletePipelineStep } from "../services/pipelineService";
import { fetchOutputs, previewOutput } from "../state/outputsSlice";
import { fetchPipelineSteps } from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import { usePipelineStepCreation } from "./usePipelineStepCreation";
import type { PendingDraftMeta } from "./usePipelineStepCreation";
import type { useToast } from "../../toasts/hooks/useToast";
import type { Output } from "../types/output";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
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

  // HEL-402 / HEL-908 task 6.3 — "Add Outputs from a shape": persists a
  // shape's `expand` response against a chosen anchor node (design.md
  // decision 11). The response has NO real step ids — `steps[].clientId` is
  // a synthetic intra-response id and `steps[].parentStepId`, when present,
  // references another entry's `clientId`, not a persisted step. So this
  // walks the response in order, maintaining a `clientId -> real id` map:
  // - The FIRST step (no `clientId`-parent inside this response, i.e. the
  //   response's own root) is created with `parentStepId` = `anchorStepId`
  //   (or omitted for the zero-step/new-pipeline case), with plain
  //   trunk-continuation semantics (no `attachAsTail`). `PipelineRiverView`'s
  //   two shape-picker triggers only ever pass an anchor that is either
  //   `undefined` (the empty-pipeline state) or the pipeline's trunk-last
  //   step — never a mid-trunk node — and (skeptic-final-2, round 1) the
  //   button is now gated by `hasTail` so a trunk-last anchor that already
  //   has a tail can never reach here in the first place. A PREVIOUS version
  //   of this handler set `attachAsTail: true` whenever the anchor "had a
  //   child" — which, for the only anchor this code path is ever fed
  //   (trunk-last), can ONLY mean "already has a tail", so that branch
  //   ALWAYS created a structurally-dead SECOND tail (reproduced live by the
  //   skeptic: server `trunkOf` stayed `[A, B]` while the shape's chain
  //   landed at `position >= 2` under B and was silently never executed).
  //   The defensive `anchorHasTail` refusal below is belt-and-suspenders in
  //   case the UI gate is ever bypassed or a future caller reintroduces a
  //   mid-trunk anchor.
  // - Every subsequent step resolves its `parentStepId` (a `clientId`
  //   reference) through the map to a real id, then creates with plain
  //   append semantics (no `attachAsTail`) — it's continuing a chain THIS
  //   batch just created, not attaching to a pre-existing occupied node.
  // - Any `outputs` entries (dormant on the shipped backend today — design.md
  //   decision 14) are created last, each `nodeStepId` resolved the same way.
  // On a mid-loop failure, stop (no further entries attempted), keep
  // whatever already succeeded (no compensating delete — matches
  // `handleRemoveStep`'s existing no-rollback semantics), and surface a
  // visible toast naming how many of N entries were added (design.md
  // Decision 6) — never a silent partial application.
  const handleInstantiateShape = useCallback(
    async (expansion: ExpandPipelineShapeResponse, anchorStepId?: string) => {
      if (!id) return;
      setStepsInitialized(true);
      const { steps: stepExpansions, outputs: outputExpansions = [] } = expansion;
      const totalEntries = stepExpansions.length + outputExpansions.length;
      const clientIdToRealId = new Map<string, string>();
      let createdCount = 0;

      // HEL-912 (design.md Decision 1) — the skeptic-final-2 `anchorHasTail`
      // refusal this used to have relied on the single-tail-per-node
      // invariant, which is gone: a node with several children just roots
      // several lanes now, so a shape's first step landing as another child
      // of the anchor is a normal new lane, not a dead branch. Removed
      // rather than adapted (design.md Risks/Trade-offs).
      try {
        for (let i = 0; i < stepExpansions.length; i++) {
          const stepExpansion = stepExpansions[i];
          const parentClientId = stepExpansion.parentStepId;
          const realParentId =
            parentClientId !== undefined ? clientIdToRealId.get(parentClientId) : anchorStepId;
          // Always plain trunk-continuation semantics (no `attachAsTail`):
          // the only anchor this handler is ever fed (trunk-last, or none
          // for an empty pipeline) never already has a trunk-continuation
          // child, so there is no reparenting exposure here -- see the
          // `anchorHasTail` refusal above for the one hazard that DOES
          // apply to this anchor (an existing tail).
          const persisted = await createPipelineStep(
            id,
            stepExpansion.kind,
            stepExpansion.config,
            undefined,
            realParentId,
            false,
            // HEL-968: only reached without a `realParentId` (an
            // empty-pipeline anchor -- root 0's own top-level lane, same as
            // `handleInsertStep`); required once the pipeline has >1 root.
            roots[0]?.id,
          );
          clientIdToRealId.set(stepExpansion.clientId, persisted.id);
          setSteps((prev) => [...prev, pipelineStepToStep(persisted)]);
          createdCount += 1;
        }
        for (const outputExpansion of outputExpansions) {
          const realNodeStepId = clientIdToRealId.get(outputExpansion.nodeStepId);
          await createOutput(id, {
            nodeStepId: realNodeStepId,
            kind: outputExpansion.kind,
            name: outputExpansion.name ?? outputExpansion.kind,
            config: outputExpansion.config,
          });
          createdCount += 1;
        }
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "Failed to apply shape.");
        pushToast({
          variant: "error",
          message: `Shape only partially applied: ${createdCount} of ${totalEntries} entries were added (${message}).`,
        });
        return;
      }
      // CR9 audit, corrected (skeptic-final-2, round 1, CR1) — unlike
      // `handleInsertStep`/`handleAddTailStep`/`handleAddOutputViaAggregateTail`,
      // this loop's own creates carry no reparenting exposure: the only entry
      // that can target a PRE-EXISTING node (`anchorStepId`) is the first,
      // it always uses plain trunk-continuation semantics (never
      // `attachAsTail`), and the `anchorHasTail` refusal above guarantees
      // that anchor never already has a trunk-continuation child to
      // reparent. Every later entry's `realParentId` is a step this same
      // batch just created seconds earlier, which cannot yet have any other
      // children to reparent. No resync needed here.
    },
    [id, pushToast, roots, setSteps, setStepsInitialized],
  );

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
