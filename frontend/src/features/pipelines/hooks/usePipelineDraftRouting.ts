import { useCallback } from "react";

import { liveTrunkIds, trunkAfterMove } from "../state/draftOps";
import { computeInsertAnchor } from "../state/insertAnchor";
import { defaultConfigFor, isTempStepId } from "../state/stepNarrowing";
import type { PipelineRoot, PipelineStepConfig } from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import { useLatestCallback } from "./useLatestCallback";
import type { PipelineDraft } from "./usePipelineDraft";

/** The immediate (no draft open) path of each action; `usePipelineDraftRouting` decides between it and a draft op. */
export interface ImmediateStepHandlers {
  handleTempStepConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  handleRemoveSavedStep: (stepId: string) => void;
  handleToggleTempStepEnabled: (stepId: string, enabled: boolean) => Promise<void>;
  handleAddStepNow: (opType: OpType) => Promise<void> | void;
  handleInsertStepNow: (opType: OpType, index: number) => Promise<void>;
  handleAddLaneStepNow: (opType: OpType, parentStepId: string) => Promise<void>;
  handleDuplicateStepNow: (stepId: string) => Promise<void> | void;
  handleReorderStepsNow: (newOrder: Step[]) => void | Promise<void>;
}

/**
 * The single place a page action decides "draft op vs. immediate write" (HEL-1704 split of `usePipelineDetailPage`; HEL-1733 and
 * HEL-1734 add their Output and root routing here).
 *
 * HEL-1631 (design.md D6): a config edit, an enabled toggle or a delete of a saved step changes only the draft; a step that is
 * still a not-yet-created AI draft (temp id) keeps its existing local create flow.
 * HEL-1684 (design.md D3): while a draft exists, the step structure actions record a draft op instead of writing; with no draft
 * open each keeps its immediate path. Latest-closure callbacks keep the identities the memoised cards rely on (F-146).
 */
export function usePipelineDraftRouting({
  draft,
  roots,
  draftSteps,
  handlers,
}: {
  draft: PipelineDraft;
  roots: PipelineRoot[];
  draftSteps: Step[];
  handlers: ImmediateStepHandlers;
}) {
  const {
    handleTempStepConfigChange,
    handleRemoveSavedStep,
    handleToggleTempStepEnabled,
    handleAddStepNow,
    handleInsertStepNow,
    handleAddLaneStepNow,
    handleDuplicateStepNow,
    handleReorderStepsNow,
  } = handlers;
  const { setConfig, setEnabled, deleteStep } = draft;
  const handleStepConfigChange = useCallback(
    (stepId: string, config: PipelineStepConfig) => {
      if (isTempStepId(stepId)) handleTempStepConfigChange(stepId, config);
      else setConfig(stepId, config);
    },
    [handleTempStepConfigChange, setConfig],
  );
  const handleRemoveStep = useCallback(
    (stepId: string) => {
      if (isTempStepId(stepId)) handleRemoveSavedStep(stepId);
      else deleteStep(stepId);
    },
    [handleRemoveSavedStep, deleteStep],
  );
  const handleToggleStepEnabled = useCallback(
    (stepId: string, enabled: boolean): Promise<void> => {
      if (isTempStepId(stepId)) return handleToggleTempStepEnabled(stepId, enabled);
      setEnabled(stepId, enabled);
      return Promise.resolve();
    },
    [handleToggleTempStepEnabled, setEnabled],
  );

  const { insertStep, addLaneStep, duplicateStep, reorderTrunk } = draft;
  const inDraft = draft.hasDraft;
  const handleAddStep = useLatestCallback((opType: OpType) => {
    const rootId = roots[0]?.id;
    if (!inDraft || rootId === undefined) return handleAddStepNow(opType);
    insertStep(opType.id, defaultConfigFor(opType.id), { append: rootId });
  });
  const handleInsertStep = useLatestCallback((opType: OpType, index: number): Promise<void> => {
    const rootId = roots[0]?.id;
    if (!inDraft || rootId === undefined) return handleInsertStepNow(opType, index);
    // Anchored over the DRAFT lane (temp steps skipped), never `stepsRef`'s length: an index into a draft holding new steps can
    // exceed the saved length without being an append.
    const anchor = computeInsertAnchor(draftSteps, roots, index);
    insertStep(
      opType.id,
      defaultConfigFor(opType.id),
      anchor.kind === "head" ? { head: rootId } : { after: anchor.stepId },
    );
    return Promise.resolve();
  });
  const handleAddLaneStep = useLatestCallback(
    (opType: OpType, parentStepId: string): Promise<void> => {
      if (!inDraft) return handleAddLaneStepNow(opType, parentStepId);
      if (!isTempStepId(parentStepId))
        addLaneStep(opType.id, defaultConfigFor(opType.id), parentStepId);
      return Promise.resolve();
    },
  );
  const handleDuplicateStep = useLatestCallback((stepId: string) => {
    if (!inDraft) return handleDuplicateStepNow(stepId);
    if (!isTempStepId(stepId)) duplicateStep(stepId);
  });
  const handleReorderSteps = useLatestCallback((newOrder: Step[]): void | Promise<void> => {
    if (!inDraft) return handleReorderStepsNow(newOrder);
    for (const root of roots) {
      const before = liveTrunkIds(draftSteps, root.id);
      if (before.length < 2) continue;
      const after = trunkAfterMove(newOrder, root.id, before);
      if (after.length !== before.length || after.every((id, i) => id === before[i])) continue;
      reorderTrunk(root.id, after);
    }
  });

  return {
    handleStepConfigChange,
    handleRemoveStep,
    handleToggleStepEnabled,
    handleAddStep,
    handleInsertStep,
    handleAddLaneStep,
    handleDuplicateStep,
    handleReorderSteps,
  };
}
