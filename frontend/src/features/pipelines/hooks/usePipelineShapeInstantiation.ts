import { useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { createOutput } from "../services/outputService";
import { createPipelineStep } from "../services/pipelineService";
import type { CreatedPipelineStep } from "../services/pipelineService";
import type { useToast } from "../../toasts/hooks/useToast";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { PipelineRoot } from "../types/pipelineStep";

type UsePipelineShapeInstantiationArgs = {
  id: string | undefined;
  roots: PipelineRoot[];
  // `usePipelineStepCreation`'s delta application, shared so one reparent bookkeeping serves every
  // create path (see `applyCreatedStep`).
  applyCreated: (tempId: string, created: CreatedPipelineStep) => void;
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
  applyCreated,
  setStepsInitialized,
  pushToast,
}: UsePipelineShapeInstantiationArgs) {
  const shapeCreateSeq = useRef(0);
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
  //   That splice reparents EVERY existing child of the anchor under the new
  //   step. When the primary lane's last step has lane children (position >= 1,
  //   e.g. after "+ lane" on it), they end up under the shape's last step on the
  //   server (HEL-1506, owner-chosen: same as the bottom "+ add step"). Each
  //   create's `reparentedStepIds` is applied to the local steps right after its
  //   POST (`applyCreated`), so the editor shows the server structure with no
  //   reload.
  // - Every subsequent step resolves its `parentStepId` (a `clientId`
  //   reference) through the map to a real id, then creates with a plain
  //   splice (no `attachAsTail`) under a step THIS batch just created. A lane
  //   moved by an earlier create is reported again here, since it is by then
  //   a child of that just-created step.
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

      try {
        for (let i = 0; i < stepExpansions.length; i++) {
          const stepExpansion = stepExpansions[i];
          const parentClientId = stepExpansion.parentStepId;
          const realParentId =
            parentClientId !== undefined ? clientIdToRealId.get(parentClientId) : anchorStepId;
          // Always a plain splice (no `attachAsTail`); lane children of the
          // anchor are reparented by the server and applied below.
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
          // A shape step has no local temp step: a synthetic, never-present, never-removed temp
          // id makes `applyCreatedStep` append it, and applies the splice's `reparentedStepIds`.
          applyCreated(`shape-apply-${(shapeCreateSeq.current += 1)}`, persisted);
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
    },
    [id, pushToast, roots, applyCreated, setStepsInitialized],
  );

  return handleInstantiateShape;
}
