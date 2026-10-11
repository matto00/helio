import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createOutput } from "../services/outputService";
import { createPipelineStep } from "../services/pipelineService";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { useToast } from "../../toasts/hooks/useToast";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";

type UsePipelineShapeInstantiationArgs = {
  id: string | undefined;
  roots: PipelineRoot[];
  setSteps: Dispatch<SetStateAction<Step[]>>;
  setStepsInitialized: Dispatch<SetStateAction<boolean>>;
  pushToast: ReturnType<typeof useToast>["push"];
};

/**
 * `handleInstantiateShape`, extracted from `usePipelineStepStructure` (HEL-1481): persists a shape
 * `expand` response against a chosen anchor node.
 */
export function usePipelineShapeInstantiation({
  id,
  roots,
  setSteps,
  setStepsInitialized,
  pushToast,
}: UsePipelineShapeInstantiationArgs) {
  // HEL-402 / HEL-908 task 6.3 — "Add Outputs from a shape": persists a
  // shape's `expand` response against a chosen anchor node (design.md
  // decision 11). The response has NO real step ids — `steps[].clientId` is
  // a synthetic intra-response id and `steps[].parentStepId`, when present,
  // references another entry's `clientId`, not a persisted step. So this
  // walks the response in order, maintaining a `clientId -> real id` map:
  // - The FIRST step (no `clientId`-parent inside this response, i.e. the
  //   response's own root) is created with `parentStepId` = `anchorStepId`
  //   (or omitted for the zero-step/new-pipeline case) and WITHOUT
  //   `attachAsTail`, so the backend splice-inserts it directly after the
  //   anchor. `PipelineRiverView`'s two shape-picker triggers pass either
  //   `undefined` (the empty-pipeline state) or the last step of root 0's
  //   primary lane. The button is not gated on the anchor's children.
  //   KNOWN HAZARD (HEL-1506, probed live): a splice reparents
  //   EVERY existing child of the anchor under the new step. When the
  //   primary lane's last step has only lane children (position >= 1, e.g.
  //   after "+ lane" on it), applying a shape moves those lanes under the
  //   shape's last step on the server, while the local `steps` state is not
  //   updated for it (this handler ignores the create responses'
  //   `reparentedStepIds`). Probed: right after apply the shape cards are
  //   appended into the lane next to the old lane step; the server structure
  //   only shows after a reload. No code here guards or resyncs that case.
  // - Every subsequent step resolves its `parentStepId` (a `clientId`
  //   reference) through the map to a real id, then creates with a plain
  //   splice (no `attachAsTail`) under a step THIS batch just created. In
  //   the hazard case above each of these creates also reports the moved
  //   lane in `reparentedStepIds`, since the lane is by then a child of
  //   that just-created step.
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

      // HEL-912 (design.md Decision 1) removed the old `anchorHasTail`
      // refusal: it relied on the single-tail-per-node invariant, which is
      // gone. Nothing replaced it -- see the KNOWN HAZARD note above for what
      // an anchor that already has lane children now costs.
      try {
        for (let i = 0; i < stepExpansions.length; i++) {
          const stepExpansion = stepExpansions[i];
          const parentClientId = stepExpansion.parentStepId;
          const realParentId =
            parentClientId !== undefined ? clientIdToRealId.get(parentClientId) : anchorStepId;
          // Always a plain splice (no `attachAsTail`). The anchor has no
          // continuation child, but it may have lane children, which the
          // splice reparents -- see the KNOWN HAZARD note above.
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
      // Reparenting audit: only the FIRST create can target a pre-existing
      // node (`anchorStepId`), and as a plain splice it reparents that
      // anchor's existing children (see the KNOWN HAZARD note above); no
      // resync is done here. Later entries splice under a step this batch
      // just created; if the hazard case moved a lane under it, that splice
      // moves the lane again (probed: the second POST also reported it).
    },
    [id, pushToast, roots, setSteps, setStepsInitialized],
  );

  return handleInstantiateShape;
}
