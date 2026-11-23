import { useCallback } from "react";

import { liveTrunkIds, newClientId, trunkAfterMove } from "../state/draftOps";
import type { DraftOp, DraftOutputNode } from "../state/draftOps";
import { draftMerge, outputFromCreate } from "../state/draftOutputs";
import { computeInsertAnchor } from "../state/insertAnchor";
import { defaultConfigFor, isTempStepId } from "../state/stepNarrowing";
import type { DataSource } from "../../sources/types/dataSource";
import type { Output } from "../types/output";
import type { OutputActions } from "./useOutputImmediateActions";
import type { ExpandPipelineShapeResponse } from "../types/pipelineShape";
import type { AggregateConfig, PipelineRoot, PipelineStepConfig } from "../types/pipelineStep";
import type { OpType, Step } from "../types/step";
import { useLatestCallback } from "./useLatestCallback";
import type { PipelineDraft } from "./usePipelineDraft";

/** The immediate (no draft open) path of each action; `usePipelineDraftRouting` decides between it and a draft op. */
export interface ImmediateStepHandlers {
  /** HEL-1734: the immediate add / remove of a source (a root) when no draft is open. */
  handleAddRootNow: (sourceId: string) => Promise<void>;
  handleRemoveRootNow: (rootId: string) => Promise<void>;
  handleTempStepConfigChange: (stepId: string, config: PipelineStepConfig) => void;
  handleRemoveSavedStep: (stepId: string) => void;
  handleToggleTempStepEnabled: (stepId: string, enabled: boolean) => Promise<void>;
  handleAddStepNow: (opType: OpType) => Promise<void> | void;
  handleInsertStepNow: (opType: OpType, index: number) => Promise<void>;
  handleAddLaneStepNow: (opType: OpType, parentStepId: string) => Promise<void>;
  handleDuplicateStepNow: (stepId: string) => Promise<void> | void;
  handleReorderStepsNow: (newOrder: Step[]) => void | Promise<void>;
  /** HEL-1733: the shape and aggregate-tail immediate paths (the Output create/edit/delete immediate path lives in the sheet). */
  handleInstantiateShapeNow: (
    expansion: ExpandPipelineShapeResponse,
    anchorStepId?: string,
  ) => Promise<void>;
  /** The immediate Output writes (`useOutputImmediateActions`). */
  outputActionsNow: OutputActions;
  handleAddOutputViaAggregateTailNow: (
    parentStepId: string,
    aggregateConfig: AggregateConfig,
    outputPayload: { kind: string; name: string; config: Record<string, unknown> },
  ) => Promise<Output>;
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
  sources,
  handlers,
  editable,
}: {
  draft: PipelineDraft;
  roots: PipelineRoot[];
  draftSteps: Step[];
  sources: readonly DataSource[];
  handlers: ImmediateStepHandlers;
  /** HEL-1794 (design.md D2): false = every edit handler returns at once (no write, no overlay op). */
  editable: boolean;
}) {
  const {
    handleAddRootNow,
    handleRemoveRootNow,
    handleTempStepConfigChange,
    handleRemoveSavedStep,
    handleToggleTempStepEnabled,
    handleAddStepNow,
    handleInsertStepNow,
    handleAddLaneStepNow,
    handleDuplicateStepNow,
    handleReorderStepsNow,
    handleInstantiateShapeNow,
    handleAddOutputViaAggregateTailNow,
    outputActionsNow,
  } = handlers;
  const { setConfig, setEnabled, deleteStep } = draft;
  const handleStepConfigChange = useCallback(
    (stepId: string, config: PipelineStepConfig) => {
      if (!editable) return;
      if (isTempStepId(stepId)) handleTempStepConfigChange(stepId, config);
      else setConfig(stepId, config);
    },
    [editable, handleTempStepConfigChange, setConfig],
  );
  const handleRemoveStep = useCallback(
    (stepId: string) => {
      if (!editable) return;
      if (isTempStepId(stepId)) handleRemoveSavedStep(stepId);
      else deleteStep(stepId);
    },
    [editable, handleRemoveSavedStep, deleteStep],
  );
  const handleToggleStepEnabled = useCallback(
    (stepId: string, enabled: boolean): Promise<void> => {
      if (!editable) return Promise.resolve();
      if (isTempStepId(stepId)) return handleToggleTempStepEnabled(stepId, enabled);
      setEnabled(stepId, enabled);
      return Promise.resolve();
    },
    [editable, handleToggleTempStepEnabled, setEnabled],
  );

  const { insertStep, addLaneStep, duplicateStep, reorderTrunk } = draft;
  const inDraft = draft.hasDraft;
  const handleAddStep = useLatestCallback((opType: OpType) => {
    if (!editable) return;
    const rootId = roots[0]?.id;
    if (!inDraft || rootId === undefined) return handleAddStepNow(opType);
    insertStep(opType.id, defaultConfigFor(opType.id), { append: rootId });
  });
  const handleInsertStep = useLatestCallback((opType: OpType, index: number): Promise<void> => {
    if (!editable) return Promise.resolve();
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
      if (!editable) return Promise.resolve();
      if (!inDraft) return handleAddLaneStepNow(opType, parentStepId);
      if (!isTempStepId(parentStepId))
        addLaneStep(opType.id, defaultConfigFor(opType.id), parentStepId);
      return Promise.resolve();
    },
  );
  const handleDuplicateStep = useLatestCallback((stepId: string) => {
    if (!editable) return;
    if (!inDraft) return handleDuplicateStepNow(stepId);
    if (!isTempStepId(stepId)) duplicateStep(stepId);
  });
  const handleReorderSteps = useLatestCallback((newOrder: Step[]): void | Promise<void> => {
    if (!editable) return;
    if (!inDraft) return handleReorderStepsNow(newOrder);
    for (const root of roots) {
      const before = liveTrunkIds(draftSteps, root.id);
      if (before.length < 2) continue;
      const after = trunkAfterMove(newOrder, root.id, before);
      if (after.length !== before.length || after.every((id, i) => id === before[i])) continue;
      reorderTrunk(root.id, after);
    }
  });

  // ── HEL-1734: adding and removing a source (a root) are draft entries while a draft exists ──
  const { addRoot, removeRoot } = draft;
  const handleAddRoot = useLatestCallback((sourceId: string): Promise<void> => {
    if (!editable) return Promise.resolve();
    if (!inDraft) return handleAddRootNow(sourceId);
    if (sourceId === "") return Promise.resolve();
    addRoot(sourceId, sources.find((s) => s.id === sourceId)?.name ?? "Source");
    return Promise.resolve();
  });
  const handleRemoveRoot = useLatestCallback((rootId: string): Promise<void> => {
    if (!editable) return Promise.resolve();
    if (!inDraft) return handleRemoveRootNow(rootId);
    removeRoot(rootId);
    return Promise.resolve();
  });

  // ── HEL-1733: Output create/edit/delete, shapes and the aggregate tail are draft entries while a draft exists ──
  const { createOutput, editOutput, deleteOutput, appendOps } = draft;
  /** The node a created Output binds to: a real step, or the pipeline's ONLY root (the server's own no-step rule). A temp
   *  (`step-N`) step and a multi-root pipeline's "Pipeline source" are refused, never recorded or guessed. */
  const nodeFor = (nodeStepId: string | undefined): DraftOutputNode => {
    if (nodeStepId !== undefined) {
      if (isTempStepId(nodeStepId))
        throw new Error("Save the new step before adding an Output to it.");
      return { step: nodeStepId };
    }
    if (roots.length !== 1) throw new Error("Pick a step: this pipeline has several sources.");
    return { root: roots[0].id };
  };
  const handleCreateOutput = useLatestCallback(
    (payload: Parameters<OutputActions["create"]>[0]): void | Promise<void> => {
      if (!editable) return;
      if (!inDraft) return outputActionsNow.create(payload);
      createOutput(nodeFor(payload.nodeStepId), payload.kind, payload.name.trim(), payload.config);
    },
  );
  /** Records the WHOLE resulting config: the sheet's patch laid over the Output's current draft config (D4). */
  const handleUpdateOutput = useLatestCallback(
    (
      output: Output,
      payload: { name: string; config?: Record<string, unknown> },
    ): void | Promise<void> => {
      if (!editable) return;
      if (!inDraft) return outputActionsNow.update(output, payload);
      if (payload.name.trim() === "") throw new Error("An Output needs a name.");
      editOutput(output.id, {
        name: payload.name.trim(),
        config: draftMerge(output.config, payload.config ?? {}),
      });
    },
  );
  const handleDeleteOutput = useLatestCallback((output: Output): void | Promise<void> => {
    if (!editable) return;
    if (!inDraft) return outputActionsNow.remove(output);
    deleteOutput(output.id);
  });

  const handleInstantiateShape = useLatestCallback(
    (expansion: ExpandPipelineShapeResponse, anchorStepId?: string): Promise<void> => {
      if (!editable) return Promise.resolve();
      if (!inDraft) return handleInstantiateShapeNow(expansion, anchorStepId);
      if (anchorStepId !== undefined && isTempStepId(anchorStepId)) return Promise.resolve();
      const rootId = roots[0]?.id;
      const fresh = new Map<string, string>();
      for (const e of expansion.steps) fresh.set(e.clientId, newClientId());
      const ops: DraftOp[] = expansion.steps.map((e) => {
        const clientId = fresh.get(e.clientId) as string;
        const parentFresh = e.parentStepId !== undefined ? fresh.get(e.parentStepId) : undefined;
        const anchor =
          parentFresh !== undefined
            ? { after: parentFresh }
            : anchorStepId !== undefined
              ? { after: anchorStepId }
              : { append: rootId ?? "" };
        return { kind: "insert", clientId, type: e.kind, config: e.config, anchor };
      });
      for (const o of expansion.outputs ?? []) {
        const node = fresh.get(o.nodeStepId);
        if (node === undefined) continue;
        ops.push({
          kind: "outputCreate",
          clientId: newClientId(),
          node: { step: node },
          outputKind: o.kind,
          name: o.name ?? o.kind,
          config: o.config ?? {},
        });
      }
      // One overlay update: a shape is never half in the draft.
      appendOps(ops);
      return Promise.resolve();
    },
  );

  const handleAddOutputViaAggregateTail = useLatestCallback(
    (
      parentStepId: string,
      aggregateConfig: AggregateConfig,
      outputPayload: { kind: string; name: string; config: Record<string, unknown> },
    ): Promise<Output> => {
      if (!editable) return Promise.reject(new Error("This pipeline is view only."));
      if (!inDraft)
        return handleAddOutputViaAggregateTailNow(parentStepId, aggregateConfig, outputPayload);
      if (isTempStepId(parentStepId))
        return Promise.reject(new Error("Save the new step before adding a tail to it."));
      const laneId = newClientId();
      const create: Extract<DraftOp, { kind: "outputCreate" }> = {
        kind: "outputCreate",
        clientId: newClientId(),
        node: { step: laneId },
        outputKind: outputPayload.kind,
        name: outputPayload.name.trim(),
        config: outputPayload.config,
      };
      appendOps([
        {
          kind: "lane",
          clientId: laneId,
          type: "aggregate",
          config: aggregateConfig,
          parent: parentStepId,
        },
        create,
      ]);
      return Promise.resolve(outputFromCreate(create));
    },
  );

  return {
    handleAddRoot,
    handleRemoveRoot,
    handleCreateOutput,
    handleUpdateOutput,
    handleDeleteOutput,
    handleInstantiateShape,
    handleAddOutputViaAggregateTail,
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
