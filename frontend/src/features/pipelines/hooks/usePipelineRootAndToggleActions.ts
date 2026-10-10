import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { useInFlightGuard } from "../../../hooks/useInFlightGuard";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import {
  addPipelineRoot,
  duplicatePipelineStep,
  removePipelineRoot,
  updatePipelineStepEnabled,
} from "../services/pipelineService";
import { fetchPipelineById } from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { useToast } from "../../toasts/hooks/useToast";
import type { Step } from "../types/step";

type UsePipelineRootAndToggleActionsArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  pushToast: ReturnType<typeof useToast>["push"];
  syncStepsFromServer: () => Promise<void>;
};

/**
 * The root add/remove, enable-toggle and duplicate handlers extracted from `usePipelineDetailPage`
 * (HEL-1465), the second half of the `StepCard`-prop step mutations (F-146).
 */
export function usePipelineRootAndToggleActions({
  id,
  dispatch,
  stepsRef,
  setSteps,
  pushToast,
  syncStepsFromServer,
}: UsePipelineRootAndToggleActionsArgs) {
  // HEL-968 task 8 — "+ root": `sourceId` is either an existing source the
  // caller picked, or one just created via the nested `AddSourceModal`
  // (mirrors `CreatePipelineModal`'s composition, design.md D4). Refetches
  // the pipeline afterward so `currentPipeline.roots` (and this hook's own
  // `roots`/`laneGraph`) reflect the new root without a page reload -- the
  // new root has no steps yet, so no `syncStepsFromServer()` is needed.
  const handleAddRoot = useCallback(
    async (sourceId: string) => {
      if (!id) return;
      // D4 — refuse in the handler too, not just via the disabled confirm
      // control (HEL-620 was exactly a picker defaulting to an unset id and
      // issuing a request that 404'd on the ACL check).
      if (!sourceId) return;
      try {
        await addPipelineRoot(id, { sourceId });
        void dispatch(fetchPipelineById(id));
      } catch (err: unknown) {
        const message = extractErrorMessage(err, "the request could not be completed.");
        pushToast({ variant: "error", message: `Failed to add source: ${message}` });
      }
    },
    [id, dispatch, pushToast],
  );

  // HEL-968 task 9 — root removal (R7). No client-side pre-check duplicates
  // the backend's two refusals (last root; a surviving lane referencing a
  // node this root's removal would delete) -- the server's named refusal is
  // rendered verbatim (design.md D5's "the client renders the server's
  // refusal; it does not re-derive it"). On success, resyncs both the
  // pipeline (its `roots[]` shrank) and the step list (the root's steps and
  // their Outputs are gone), then surfaces the exact counts the response
  // reported.
  const handleRemoveRoot = useCallback(
    async (rootId: string) => {
      if (!id) return;
      try {
        const result = await removePipelineRoot(id, rootId);
        await Promise.all([dispatch(fetchPipelineById(id)), syncStepsFromServer()]);
        pushToast({
          variant: "success",
          message: `Source removed: ${result.removedStepCount} step${
            result.removedStepCount === 1 ? "" : "s"
          }, ${result.removedOutputCount} Output${
            result.removedOutputCount === 1 ? "" : "s"
          } removed.`,
        });
      } catch (err: unknown) {
        // R7 phase 1's two named refusals ("last root" / "surviving lane
        // referencing a deleted node") arrive as the server's own message
        // via `extractErrorMessage` -- rendered as-is, not remapped to a
        // second, drifting client-side copy. Only the CLIENT'S OWN "Failed
        // to remove source:" prefix is copy (HEL-1022: a root is a "source"
        // in user-facing text) -- the server's message after the colon is
        // never touched.
        const message = extractErrorMessage(err, "the request could not be completed.");
        pushToast({ variant: "error", message: `Failed to remove source: ${message}` });
      }
    },
    [id, dispatch, pushToast, syncStepsFromServer],
  );

  // HEL-412 — optimistic flip → PATCH `{enabled}` → reconcile from the
  // response; revert + toast on failure (the reorder handler's precedent
  // above: a silently-lost disable is worse than a snap-back).
  const handleToggleStepEnabled = useCallback(
    async (stepId: string, enabled: boolean) => {
      const previousSteps = stepsRef.current;
      setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, enabled } : s)));
      try {
        const persisted = await updatePipelineStepEnabled(stepId, enabled);
        setSteps((prev) =>
          prev.map((s) =>
            s.id === stepId ? { ...pipelineStepToStep(persisted), renderKey: s.renderKey } : s,
          ),
        );
      } catch (err: unknown) {
        setSteps(previousSteps);
        const message = extractErrorMessage(err, "Failed to update step.");
        pushToast({
          variant: "error",
          message: `Failed to ${enabled ? "enable" : "disable"} step: ${message}`,
        });
      }
    },
    [pushToast, stepsRef, setSteps],
  );

  // HEL-412 — call the duplicate endpoint, then splice the clone in directly
  // after the original (server already renumbered positions; local order is
  // what renders). Non-optimistic by design (design.md Decision 7) — there's
  // no user-entered config to preserve ahead of the response, so a temp-step
  // placeholder buys nothing for a single fast POST.
  // HEL-706 — synchronous ref-based re-entry guard (design.md Decision 1):
  // a genuine double-click on "Duplicate step" must produce exactly one
  // clone, not two.
  const { guardedRun: guardedStepDuplicateRun, pendingKeys: duplicatingStepIds } =
    useInFlightGuard<string>();

  const handleDuplicateStep = useCallback(
    (stepId: string) => {
      guardedStepDuplicateRun(stepId, async () => {
        try {
          await duplicatePipelineStep(stepId);
          // CR10 — `duplicatePipelineStep` hits the same server-side
          // `spliceInsertAtInternal` reparenting primitive as `handleInsertStep`:
          // splicing just the clone into local state (the old behavior) leaves
          // every other step's `parentStepId`/`position` stale, so a tailed
          // trunk step's clone renders as a tail branch and the real tail gets
          // promoted to a top-level trunk card until a hard reload. Resync from
          // the server, mirroring the other three CR9 fixes above.
          await syncStepsFromServer();
        } catch (err: unknown) {
          const message = extractErrorMessage(err, "Failed to duplicate step.");
          pushToast({ variant: "error", message: `Failed to duplicate step: ${message}` });
        }
      });
    },
    [guardedStepDuplicateRun, pushToast, syncStepsFromServer],
  );

  return {
    handleAddRoot,
    handleRemoveRoot,
    handleToggleStepEnabled,
    handleDuplicateStep,
    duplicatingStepIds,
  };
}
