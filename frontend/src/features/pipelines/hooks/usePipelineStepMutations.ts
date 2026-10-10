import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { deletePipelineStep, reorderPipelineSteps } from "../services/pipelineService";
import { isTempStepId, pipelineStepToStep } from "../state/stepNarrowing";
import { buildLaneGraph } from "../state/stepTree";
import type { useToast } from "../../toasts/hooks/useToast";
import type { PipelineRoot, PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

type UsePipelineStepMutationsArgs = {
  id: string | undefined;
  roots: PipelineRoot[];
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  pushToast: ReturnType<typeof useToast>["push"];
  clearDraftCreateError: (stepId: string) => void;
  createDraftIfComplete: (stepId: string, config: PipelineStepConfig) => void;
  markTempRemoved: (stepId: string) => void;
  syncStepsFromServer: () => Promise<void>;
};

/**
 * The `StepCard`-prop step mutations extracted from `usePipelineDetailPage` (HEL-1465): config
 * change, remove and reorder. Every handler keeps the identity it had in the page hook (F-146).
 */
export function usePipelineStepMutations({
  id,
  roots,
  stepsRef,
  setSteps,
  pushToast,
  clearDraftCreateError,
  createDraftIfComplete,
  markTempRemoved,
  syncStepsFromServer,
}: UsePipelineStepMutationsArgs) {
  // F-146 — `handleStepConfigChange` through `handleDuplicateStep` below are
  // all `StepCard` props (some via `PipelineRiverView` pass-through, some —
  // `handleReorderSteps` — indirectly, via `PipelineRiverView`'s own
  // `onMoveUp`/`onMoveDown`). Wrapped in `useCallback` with a stable
  // dependency set (reading `steps` through `stepsRef` above instead of
  // closing over it directly) so their identity doesn't change on every
  // `steps` update — the precondition for `React.memo`'s `StepCard` to
  // actually skip re-rendering the steps a given edit didn't touch.
  const handleStepConfigChange = useCallback(
    (stepId: string, config: PipelineStepConfig) => {
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, config } : s)));

      clearDraftCreateError(stepId);
      createDraftIfComplete(stepId, config);
    },
    [clearDraftCreateError, createDraftIfComplete, setSteps],
  );

  // HEL-535 D5 — this used to swallow a rejected DELETE with a bare no-op
  // comment: the step vanished from the view (optimistic removal below) with
  // no toast, no inline error, no console signal, and — unlike every sibling
  // step mutation in this file (reorder/enable/duplicate, all above) — it
  // never restored local state on failure, so the app disagreed with the
  // server about whether the step still existed. Now mirrors those siblings:
  // snapshot before the optimistic change, restore + toast on rejection.
  const handleRemoveStep = useCallback(
    (stepId: string) => {
      const previousSteps = stepsRef.current;
      setSteps((prev) => prev.filter((s) => s.id !== stepId));
      // HEL-1345 D5 — a removed temp's create may still be in flight; remember it so its response
      // does not re-add the orphaned server step.
      if (isTempStepId(stepId)) markTempRemoved(stepId);
      // Persist the deletion for steps that exist server-side. Temp steps created
      // by `makeStep` carry a local `step-N` id and have no backend row yet, so a
      // DELETE would 404. Fire-and-forget mirrors the config-PATCH path in
      // useStepCardState: local state already reflects user intent.
      if (!isTempStepId(stepId)) {
        void deletePipelineStep(stepId)
          .then(() => {
            // CR11 — `deleteInternal` on the backend mutates steps OTHER than
            // the target: it reparents the deleted step's head child onto the
            // deleted step's own parent, AND cascade-deletes every other
            // child's entire descendant subtree (any tail). The bare local
            // `filter` above only removes the one element the user clicked,
            // leaving a cascade-deleted tail rendered as a live top-level
            // trunk card (a phantom for a row that no longer exists server-
            // side at all) until a hard reload. Resync from the server,
            // mirroring the CR9/CR10 fix on the sibling insert/duplicate
            // handlers above.
            return syncStepsFromServer();
          })
          .catch((err: unknown) => {
            setSteps(previousSteps);
            // skeptic-final-1.md CR2 — the fallback must read as a REASON, not
            // a restatement of the "Failed to delete step:" prefix below,
            // or a bodyless failure (network error, offline, aborted request,
            // non-JSON 5xx — anything extractErrorMessage can't pull a
            // server-supplied reason out of) renders "Failed to delete step:
            // Failed to delete step." — the doubled-sentence "Error" failure
            // mode the ticket's own copy AC forbids.
            const message = extractErrorMessage(err, "the request could not be completed.");
            pushToast({ variant: "error", message: `Failed to delete step: ${message}` });
          });
      }
    },
    [pushToast, syncStepsFromServer, markTempRemoved, stepsRef, setSteps],
  );

  // HEL-407 — drag/keyboard reorder handler (design.md Decision 7). `newOrder`
  // is the full reordered `Step[]` computed by `PipelineRiverView` (drop or
  // Move up/down). The page owns persistence, mirroring every other step
  // mutation here (local `setSteps` + a plain service call, not a thunk):
  // (a) snapshot the previous order, (b) reorder optimistically, (c) PUT the
  // *persisted* step ids only, (d) reconcile the response into the optimistic
  // order by id on success, (e) revert + toast on failure — never a silently
  // lost reorder.
  //
  // HEL-908 design.md decision 15 — `PUT /steps/order`'s request-shape
  // contract is TRUNK-ONLY — `reorderTrunkInternal` REJECTS a request
  // containing a non-trunk id. `newOrder` here is still the full flat
  // `Step[]` (every lane, whatever shape the caller computed it in).
  //
  // HEL-973: the endpoint's contract widened to the UNION of EVERY root's
  // trunk (design.md Decision 4) — a root-0-only payload (HEL-968's stopgap)
  // now 422s for every omitted root's ids on a multi-root pipeline. The
  // payload is therefore built from EXACTLY ONE lane PER ROOT — for each
  // root, the lane seeded by that root's own `position == 0` root-level step
  // — never a filter over every root-level lane: `buildLaneGraph` seeds one
  // lane per root-level step, and a root with a tail has several, the extras
  // being TAIL roots whose ids this endpoint rejects (that reading would
  // 422). A non-trunk lane's own attachment (`parentStepId` pointing at its
  // parent step's id) needs no request at all: per the human's ruling ("the
  // tail follows its trunk step"), the backend never touches non-trunk rows
  // during a trunk reorder.
  const handleReorderSteps = useCallback(
    async (newOrder: Step[]) => {
      if (!id) return;
      const previousOrder = stepsRef.current;
      // Temp (`step-N`) steps have no backend row yet — a still-in-flight POST
      // from handleAddStep/handleInstantiateShape. Sending one would fail the
      // server's set-equality check, so exclude them (mirrors handleRemoveStep's
      // temp-id no-op convention above).
      const reorderedGraph = buildLaneGraph(newOrder, roots);
      // HEL-973 evaluation-1 CR2 -- computed BEFORE the optimistic `setSteps` below (and
      // BEFORE the try/catch) so a root whose trunk lane came back empty never reaches the
      // wire as a silently truncated request. `trunkLane?.steps ?? []` alone turned "this
      // root's chain got orphaned" (CR1's defect) into a WRONG request instead of an OBVIOUS
      // one — compare each root's post-reorder trunk lane against whether it demonstrably had
      // steps beforehand, and refuse (toast, no optimistic mutation applied) rather than send
      // a partial payload that would silently omit that root's ids.
      //
      // DEFENSE-IN-DEPTH, with no live path to it (HEL-1007 measured this once reorder was wired for
      // EVERY root's trunk lane). Every UI caller -- Move up/down and drag, in any root's lane -- goes
      // through `reorderLane`, which carries `rootId` with a lane's head, so a UI move can never empty
      // a trunk (`stepTree.test.ts` asserts this over every (from, to) pair of a two-root graph). The
      // only imaginable skew is `stepsRef` (assigned in render) vs the lane owner's graph ref (assigned
      // in a passive effect), and React flushes passive effects before the next discrete event, so no
      // click can observe them out of step. Directly unit-tested as a defensive branch with a
      // hand-built `newOrder` (`PipelineDetailPage.reorderGuard.test.tsx`) -- that pins the refusal
      // behaviour, it does NOT show the state is reachable: there is still no live path to it.
      const previousGraph = buildLaneGraph(previousOrder, roots);
      const persistedIds: string[] = [];
      for (const r of roots) {
        const trunkLane = reorderedGraph.lanes.find(
          (l) => l.parentStepId === undefined && l.rootId === r.id,
        );
        const hadStepsBefore = previousGraph.lanes.some(
          (l) => l.parentStepId === undefined && l.rootId === r.id && l.steps.length > 0,
        );
        if ((trunkLane?.steps.length ?? 0) === 0 && hadStepsBefore) {
          // Name the root by its bound source, never its raw UUID -- a user-facing string
          // rendering a bare id is a defect on its own terms, independent of whether this
          // branch is currently reachable (see the coverage note above).
          pushToast({
            variant: "error",
            message: `Failed to reorder steps: the "${r.dataSourceName}" root lost its trunk lane during the reorder.`,
          });
          return;
        }
        persistedIds.push(
          ...(trunkLane?.steps ?? []).filter((s) => !isTempStepId(s.id)).map((s) => s.id),
        );
      }
      setSteps(newOrder);
      try {
        const response = await reorderPipelineSteps(id, persistedIds);
        // Reconcile by mapping over the *optimistic* newOrder, replacing each
        // persisted entry with its corresponding response entry by id. Never
        // `setSteps(response.map(...))` wholesale — the response contains only
        // persisted steps, so a wholesale replace would drop any temp step
        // still mid-flight.
        setSteps(
          newOrder.map((s) => {
            if (isTempStepId(s.id)) return s;
            const persisted = response.find((r) => r.id === s.id);
            return persisted ? { ...pipelineStepToStep(persisted), renderKey: s.renderKey } : s;
          }),
        );
      } catch (err: unknown) {
        setSteps(previousOrder);
        const message = extractErrorMessage(err, "Failed to reorder steps.");
        pushToast({ variant: "error", message: `Failed to reorder steps: ${message}` });
      }
    },
    [id, pushToast, roots, stepsRef, setSteps],
  );

  return { handleStepConfigChange, handleRemoveStep, handleReorderSteps };
}
