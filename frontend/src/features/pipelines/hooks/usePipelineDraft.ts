import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import {
  EMPTY_OVERLAY,
  applyOverlay,
  baseSignature,
  hasDraft as overlayHasDraft,
  rebaseOverlay,
  withConfig,
  withDeleted,
  withEnabled,
  type DraftOverlay,
} from "../state/pipelineDraft";
import { readKeptDraft, writeKeptDraft } from "../state/keptDraft";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** Why a structural control is unavailable while a draft exists (design.md D2, owner ruling `block-during-draft-recommended`). */
export const DRAFT_BLOCK_REASON = "Save or discard your draft first";

/**
 * HEL-1631 (design.md D1): the client-only draft on the pipeline detail page, an overlay on the saved steps. It lives on the
 * page hook so it survives the phone/desktop layout switch. The saved steps (`baseStepsRef`) are never mutated, so Discard is
 * "drop the overlay" and the page then shows exactly the saved pipeline, with no request.
 */
export function usePipelineDraft({
  baseSteps,
  baseStepsRef,
  pipelineId,
  ready,
}: {
  baseSteps: Step[];
  baseStepsRef: MutableRefObject<Step[]>;
  /** The pipeline the draft belongs to (its tab-scoped copy is keyed by it); `undefined` keeps the draft in memory only. */
  pipelineId?: string;
  /** The saved steps of `pipelineId` are loaded, so a kept draft can be re-applied over them. */
  ready: boolean;
}) {
  const [overlay, setOverlay] = useState<DraftOverlay>(EMPTY_OVERLAY);
  const overlayRef = useRef(overlay);
  useLayoutEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  // Leaving by any route (Back, the palette, Settings) cannot be held, so the draft is kept for the tab in sessionStorage WITH the
  // saved steps it was made against, and re-applied when the page opens again. If the saved steps are no longer those (someone
  // else changed the pipeline meanwhile) the draft is still restored but flagged `staleRestored`: Save & run is then refused with
  // the stale-base notice until "Reload the saved pipeline" (the existing reload-only path) re-bases it. It is never re-based
  // silently, which would make the save-time base check compare the current pipeline with itself.
  const restoredFor = useRef<string | null>(null);
  const keptBaseRef = useRef<string | null>(null);
  const [staleRestored, setStaleRestored] = useState(false);
  const staleRestoredRef = useRef(false);
  useEffect(() => {
    if (pipelineId === undefined || !ready || restoredFor.current === pipelineId) return;
    restoredFor.current = pipelineId;
    const kept = readKeptDraft(pipelineId);
    // Nothing kept: leave the overlay alone (no state change, so no extra render on open).
    if (kept !== null) {
      setOverlay(rebaseOverlay(baseStepsRef.current, kept.overlay).overlay);
      if (kept.base !== baseSignature(baseStepsRef.current)) {
        keptBaseRef.current = kept.base;
        staleRestoredRef.current = true;
        setStaleRestored(true);
      }
    } else if (overlayRef.current !== EMPTY_OVERLAY) setOverlay(EMPTY_OVERLAY);
  }, [pipelineId, ready, baseStepsRef]);
  useEffect(() => {
    if (pipelineId === undefined || restoredFor.current !== pipelineId) return;
    writeKeptDraft(
      pipelineId,
      overlayHasDraft(overlay)
        ? { overlay, base: keptBaseRef.current ?? baseSignature(baseStepsRef.current) }
        : null,
    );
  }, [pipelineId, overlay, baseSteps, baseStepsRef]);

  const draftSteps = useMemo(() => applyOverlay(baseSteps, overlay), [baseSteps, overlay]);
  const hasDraft = overlayHasDraft(overlay);

  const setConfig = useCallback(
    (stepId: string, config: PipelineStepConfig) =>
      setOverlay((prev) => withConfig(baseStepsRef.current, prev, stepId, config)),
    [baseStepsRef],
  );
  const setEnabled = useCallback(
    (stepId: string, enabled: boolean) =>
      setOverlay((prev) => withEnabled(baseStepsRef.current, prev, stepId, enabled)),
    [baseStepsRef],
  );
  const deleteStep = useCallback(
    (stepId: string) => setOverlay((prev) => withDeleted(baseStepsRef.current, prev, stepId)),
    [baseStepsRef],
  );
  const discard = useCallback(() => {
    keptBaseRef.current = null;
    staleRestoredRef.current = false;
    setStaleRestored(false);
    setOverlay(EMPTY_OVERLAY);
  }, []);

  /** Re-applies the draft over a newly loaded base, keeping the edits whose step still exists; returns how many did not. */
  const rebase = useCallback((newBase: Step[]): number => {
    const { overlay: next, dropped } = rebaseOverlay(newBase, overlayRef.current);
    keptBaseRef.current = null;
    staleRestoredRef.current = false;
    setStaleRestored(false);
    setOverlay(next);
    return dropped;
  }, []);

  return {
    overlay,
    overlayRef,
    draftSteps,
    hasDraft,
    setConfig,
    setEnabled,
    deleteStep,
    discard,
    rebase,
    staleRestored,
    staleRestoredRef,
  };
}

export type PipelineDraft = ReturnType<typeof usePipelineDraft>;
