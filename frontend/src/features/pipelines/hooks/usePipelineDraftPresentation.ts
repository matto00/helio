import { useCallback, useEffect, useMemo, useState } from "react";

import type { SpineRowDraft } from "../ui/spine/SpineStepRow";
import type { StepPreviewDraft } from "../ui/spine/StepPreviewTable";
import type { PipelinePageState } from "../ui/spine/PipelineSpineLayout";
import type { SchemaField } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { usePipelineDraftFrames } from "./usePipelineDraftFrames";
import type { StepPreviewResponse } from "../services/pipelineService";

/**
 * HEL-1631: what a layout (desktop spine or phone) needs to show the draft: the per-step frames, the row and preview draft
 * models, the editor column lists and the structural-control reason. Both layouts call this with the step they are focused on
 * (the one whose rows the server should return when it has to resolve it).
 */
export function usePipelineDraftPresentation(page: PipelinePageState, focusStepId: string | null) {
  const { draft, baseSteps, roots, draftBlockReason } = page;
  const hasDraft = draft.hasDraft;
  const frames = usePipelineDraftFrames({
    pipelineId: page.id ?? "",
    roots,
    baseSteps,
    draftSteps: page.steps,
    hasDraft,
    needBase: page.allOutputs.length > 0,
    focusStepId,
    memory: page.draftFrameMemory,
  });
  const { views, baseCounts, baseRows, sampleTruncated } = frames;

  /** The saved steps' enabled flags: the saved-preview fetch follows these, never the draft's. */
  const savedEnabledBits = useMemo(
    () => baseSteps.map((s) => (s.enabled ? "1" : "0")).join(""),
    [baseSteps],
  );
  const savedById = useMemo(() => new Map(baseSteps.map((s) => [s.id, s])), [baseSteps]);

  // Saved-config previews fetched on this page. Entries belong to one saved pipeline: the epoch names it, so a save, an undo or
  // a reload (which change the saved steps) can never serve a row set that no longer matches.
  const [savedPreviews] = useState(() => new Map<string, StepPreviewResponse>());
  const savedEpoch = useMemo(
    () =>
      baseSteps
        .map(
          (s) => `${s.id}:${s.enabled ? 1 : 0}:${s.parentStepId ?? ""}:${JSON.stringify(s.config)}`,
        )
        .join("|"),
    [baseSteps],
  );

  const draftFor = useMemo(() => {
    if (!hasDraft || views === null) return undefined;
    return (stepId: string): SpineRowDraft | undefined => {
      const view = views.get(stepId);
      if (view === undefined) return undefined;
      return {
        status: view.status,
        count: view.count,
        baseCount: baseCounts?.get(stepId) ?? null,
        sample: sampleTruncated,
      };
    };
  }, [hasDraft, views, baseCounts, sampleTruncated]);

  // Entries present when a draft starts are held for it: a step table that mounts after the draft ended (the selection a draft
  // delete displaced comes back, a render or two after Discard) starts from its held rows once, so Discard fetches nothing.
  const [held] = useState(() => new Set<string>());
  useEffect(() => {
    if (hasDraft) for (const key of savedPreviews.keys()) held.add(key);
  }, [hasDraft, savedPreviews, held]);

  const previewDraftFor = useCallback(
    (stepId: string): StepPreviewDraft => ({
      active: hasDraft,
      view: hasDraft ? views?.get(stepId) : undefined,
      savedStep: savedById.get(stepId),
      baseRows: hasDraft ? baseRows?.get(stepId) : undefined,
      savedCache: {
        store: savedPreviews,
        key: `${savedEpoch}#${stepId}`,
        held,
      },
    }),
    [hasDraft, views, savedById, baseRows, savedPreviews, savedEpoch, held],
  );

  /** The input columns the step's editor offers: the draft's own (from the parent's current frame) while a draft exists. */
  const inputSchemaFor = useCallback(
    (step: Step): SchemaField[] | null =>
      hasDraft ? frames.inputSchemaOf(step, page.getAnalyzeSchema(step.id)) : null,
    [hasDraft, frames, page],
  );

  const previewErrorFor = useCallback(
    (stepId: string): string | null => {
      const view = views?.get(stepId);
      return view?.status === "error" ? view.message : null;
    },
    [views],
  );

  return {
    frames,
    hasDraft,
    draftFor,
    draftCountsOverSample: hasDraft && sampleTruncated,
    previewDraftFor,
    inputSchemaFor,
    previewErrorFor,
    savedEnabledBits,
    structuralBlockedReason: draftBlockReason,
  };
}
