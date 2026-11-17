import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import { newClientId } from "../state/draftOps";
import type { DraftAnchor, DraftOp, DraftOutputNode } from "../state/draftOps";
import type { OutputEdit } from "../state/draftOutputs";
import {
  EMPTY_OVERLAY,
  baseSignature,
  hasDraft as overlayHasDraft,
  outputsSignature,
  pruneOverlay,
  rebaseOverlay,
  replayOverlay,
  withConfig,
  withDeleted,
  withEnabled,
  withOp,
  withOps,
  withOutputEdit,
  type DraftOverlay,
} from "../state/pipelineDraft";
import { readKeptDraft, writeKeptDraft } from "../state/keptDraft";
import type { Output } from "../types/output";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** Why a structural control is unavailable while a draft exists (design.md D2, owner ruling `block-during-draft-recommended`). */
export const DRAFT_BLOCK_REASON = "Save or discard your draft first";

/**
 * HEL-1631 (design.md D1): the client-only draft on the pipeline detail page, an overlay on the saved steps. It lives on the
 * page hook so it survives the phone/desktop layout switch. The saved steps (`baseStepsRef`) are never mutated, so Discard is
 * "drop the overlay" and the page then shows exactly the saved pipeline, with no request.
 */
/** HEL-1733 D15: whether THIS page's own `fetchOutputs` has settled. Never "loaded" because Redux still holds a previous visit's list. */
export type OutputsStatus = "loading" | "loaded" | "failed";

export function usePipelineDraft({
  baseSteps,
  baseStepsRef,
  baseOutputs,
  outputsStatus,
  pipelineId,
  ready,
}: {
  baseSteps: Step[];
  baseStepsRef: MutableRefObject<Step[]>;
  /** The saved Outputs (Redux); judged against only once `outputsStatus` is "loaded". */
  baseOutputs: Output[];
  outputsStatus: OutputsStatus;
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
  // The Output part of the replay, prune and counting waits for the page's own Outputs fetch (D15): until then `outputsForDraft`
  // is `null` and Output ops/edits are carried through untouched.
  const outputsLoaded = outputsStatus === "loaded";
  const baseOutputsRef = useRef(baseOutputs);
  const outputsLoadedRef = useRef(outputsLoaded);
  useLayoutEffect(() => {
    baseOutputsRef.current = baseOutputs;
    outputsLoadedRef.current = outputsLoaded;
  }, [baseOutputs, outputsLoaded]);
  const outs = useCallback(
    (): Output[] | null => (outputsLoadedRef.current ? baseOutputsRef.current : null),
    [],
  );

  // Leaving by any route (Back, the palette, Settings) cannot be held, so the draft is kept for the tab in sessionStorage WITH the
  // saved steps it was made against, and re-applied when the page opens again. If the saved steps are no longer those (someone
  // else changed the pipeline meanwhile) the draft is still restored but flagged `staleRestored`: Save & run is then refused with
  // the stale-base notice until "Reload the saved pipeline" (the existing reload-only path) re-bases it. It is never re-based
  // silently, which would make the save-time base check compare the current pipeline with itself.
  const restoredFor = useRef<string | null>(null);
  const keptBaseRef = useRef<string | null>(null);
  // HEL-1733 D15: the kept Outputs signature, held (like `keptBaseRef`) until it has been judged against the loaded Outputs, so the
  // writer cannot overwrite it with the current base first. `outputsBaseJudgedRef` is true when there is nothing left to judge.
  const keptOutputsBaseRef = useRef<string | null>(null);
  const outputsBaseJudgedRef = useRef(true);
  const [restoredTick, setRestoredTick] = useState(0);
  const [staleRestored, setStaleRestored] = useState(false);
  const staleRestoredRef = useRef(false);
  useEffect(() => {
    if (pipelineId === undefined || !ready || restoredFor.current === pipelineId) return;
    restoredFor.current = pipelineId;
    const kept = readKeptDraft(pipelineId);
    // Nothing kept: leave the overlay alone (no state change, so no extra render on open).
    if (kept !== null) {
      // Not re-based here: a stale draft keeps every op so "Reload the saved pipeline" can still report each one it drops.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot restore of the kept draft once the saved steps are loaded
      setOverlay(kept.overlay);
      keptOutputsBaseRef.current = kept.outputsBase ?? null;
      outputsBaseJudgedRef.current = false;
      setRestoredTick((n) => n + 1);
      if (kept.base !== baseSignature(baseStepsRef.current)) {
        keptBaseRef.current = kept.base;
        staleRestoredRef.current = true;
        setStaleRestored(true);
      }
    } else if (overlayRef.current !== EMPTY_OVERLAY) setOverlay(EMPTY_OVERLAY);
  }, [pipelineId, ready, baseStepsRef]);
  useEffect(() => {
    if (pipelineId === undefined || restoredFor.current !== pipelineId) return;
    const outputsBase =
      keptOutputsBaseRef.current ?? (outputsLoaded ? outputsSignature(baseOutputs) : undefined);
    writeKeptDraft(
      pipelineId,
      overlayHasDraft(overlay)
        ? {
            overlay,
            base: keptBaseRef.current ?? baseSignature(baseStepsRef.current),
            ...(outputsBase !== undefined ? { outputsBase } : {}),
          }
        : null,
    );
  }, [pipelineId, overlay, baseSteps, baseStepsRef, baseOutputs, outputsLoaded]);

  const replayed = useMemo(
    () =>
      overlayHasDraft(overlay)
        ? replayOverlay(baseSteps, overlay, outputsLoaded ? baseOutputs : null)
        : null,
    [baseSteps, overlay, baseOutputs, outputsLoaded],
  );
  const draftSteps = replayed === null ? baseSteps : replayed.steps;
  // The Outputs the page shows: the saved ones with the draft laid over them (the saved list itself, same identity, with no draft
  // or while the Outputs are not loaded).
  const draftOutputs = replayed?.outputs ?? baseOutputs;
  const hasDraft = overlayHasDraft(overlay);

  // The saved steps can change under a draft (an immediate write that started before it opened lands, an AI step's deferred
  // create completes): an op whose steps are gone is dropped whole and the count is reported. Skipped for a stale-restored
  // draft, whose ops stay until "Reload the saved pipeline" has counted them.
  const [droppedCount, setDroppedCount] = useState(0);
  const droppedNow = replayed?.dropped ?? 0;
  useEffect(() => {
    if (restoredFor.current !== pipelineId) return;
    // The Output-base judgement (D15): once the restore has run AND this page's Outputs are loaded (either order), before any
    // Output drop is counted. A kept `outputsBase` that differs from the loaded Outputs flips the draft to stale, so every Output
    // op is kept for "Reload the saved pipeline" to count.
    if (!outputsBaseJudgedRef.current && outputsLoaded) {
      outputsBaseJudgedRef.current = true;
      const keptSig = keptOutputsBaseRef.current;
      if (keptSig !== null) {
        if (keptSig !== outputsSignature(baseOutputsRef.current)) {
          staleRestoredRef.current = true;
          // eslint-disable-next-line react-hooks/set-state-in-effect -- the one-shot Output-base judgement of a restored draft
          setStaleRestored(true);
        } else keptOutputsBaseRef.current = null;
      }
    }
    if (droppedNow === 0 || staleRestoredRef.current) return;
    setDroppedCount((n) => n + droppedNow);
    setOverlay((prev) => pruneOverlay(baseStepsRef.current, prev, false, outs()));
  }, [droppedNow, pipelineId, baseStepsRef, outputsLoaded, restoredTick, outs]);
  const clearDropped = useCallback(() => setDroppedCount(0), []);

  const setConfig = useCallback(
    (stepId: string, config: PipelineStepConfig) =>
      setOverlay((prev) =>
        withConfig(baseStepsRef.current, prev, stepId, config, staleRestoredRef.current, outs()),
      ),
    [baseStepsRef, outs],
  );
  const setEnabled = useCallback(
    (stepId: string, enabled: boolean) =>
      setOverlay((prev) =>
        withEnabled(baseStepsRef.current, prev, stepId, enabled, staleRestoredRef.current, outs()),
      ),
    [baseStepsRef, outs],
  );
  const deleteStep = useCallback(
    (stepId: string) =>
      setOverlay((prev) =>
        withDeleted(baseStepsRef.current, prev, stepId, staleRestoredRef.current, outs()),
      ),
    [baseStepsRef, outs],
  );
  const insertStep = useCallback(
    (type: string, config: PipelineStepConfig, anchor: DraftAnchor) =>
      setOverlay((prev) =>
        withOp(
          baseStepsRef.current,
          prev,
          { kind: "insert", clientId: newClientId(), type, config, anchor },
          staleRestoredRef.current,
          outs(),
        ),
      ),
    [baseStepsRef, outs],
  );
  const addLaneStep = useCallback(
    (type: string, config: PipelineStepConfig, parent: string) =>
      setOverlay((prev) =>
        withOp(
          baseStepsRef.current,
          prev,
          { kind: "lane", clientId: newClientId(), type, config, parent },
          staleRestoredRef.current,
          outs(),
        ),
      ),
    [baseStepsRef, outs],
  );
  /** A copy of the step as the draft shows it now (its kind, edited config and enabled flag are captured in the op). */
  const duplicateStep = useCallback(
    (stepId: string) =>
      setOverlay((prev) => {
        const source = replayOverlay(baseStepsRef.current, prev).steps.find((s) => s.id === stepId);
        if (!source) return prev;
        return withOp(
          baseStepsRef.current,
          prev,
          {
            kind: "duplicate",
            clientId: newClientId(),
            of: stepId,
            type: source.opType.id,
            config: source.config,
            enabled: source.enabled,
          },
          staleRestoredRef.current,
          outs(),
        );
      }),
    [baseStepsRef, outs],
  );
  const reorderTrunk = useCallback(
    (rootId: string, trunk: string[]) =>
      setOverlay((prev) =>
        withOp(
          baseStepsRef.current,
          prev,
          { kind: "reorder", rootId, trunk },
          staleRestoredRef.current,
          outs(),
        ),
      ),
    [baseStepsRef, outs],
  );
  /** HEL-1733: an Output created on `node`; returns its client id. */
  const createOutput = useCallback(
    (
      node: DraftOutputNode,
      outputKind: string,
      name: string,
      config: Record<string, unknown>,
    ): string => {
      const clientId = newClientId();
      setOverlay((prev) =>
        withOp(
          baseStepsRef.current,
          prev,
          { kind: "outputCreate", clientId, node, outputKind, name, config },
          staleRestoredRef.current,
          outs(),
        ),
      );
      return clientId;
    },
    [baseStepsRef, outs],
  );
  /** Records the WHOLE resulting name/config of a saved or created Output. */
  const editOutput = useCallback(
    (outputId: string, edit: OutputEdit) =>
      setOverlay((prev) =>
        withOutputEdit(
          baseStepsRef.current,
          prev,
          outputId,
          edit,
          staleRestoredRef.current,
          outs(),
        ),
      ),
    [baseStepsRef, outs],
  );
  const deleteOutput = useCallback(
    (outputId: string) =>
      setOverlay((prev) =>
        withOp(
          baseStepsRef.current,
          prev,
          { kind: "outputDelete", outputId },
          staleRestoredRef.current,
          outs(),
        ),
      ),
    [baseStepsRef, outs],
  );
  /** Several ops in ONE update (a shape, the aggregate tail): never half in the draft, one render, one kept-draft write. */
  const appendOps = useCallback(
    (ops: DraftOp[]) =>
      setOverlay((prev) =>
        withOps(baseStepsRef.current, prev, ops, staleRestoredRef.current, outs()),
      ),
    [baseStepsRef, outs],
  );
  const discard = useCallback(() => {
    keptOutputsBaseRef.current = null;
    outputsBaseJudgedRef.current = true;
    keptBaseRef.current = null;
    staleRestoredRef.current = false;
    setStaleRestored(false);
    setDroppedCount(0);
    setOverlay(EMPTY_OVERLAY);
  }, []);

  /** Re-applies the draft over a newly loaded base, keeping the edits whose step still exists; returns how many did not. */
  const rebase = useCallback((newBase: Step[], newBaseOutputs: Output[] | null): number => {
    const { overlay: next, dropped } = rebaseOverlay(newBase, overlayRef.current, newBaseOutputs);
    keptBaseRef.current = null;
    keptOutputsBaseRef.current = null;
    outputsBaseJudgedRef.current = true;
    staleRestoredRef.current = false;
    setStaleRestored(false);
    setOverlay(next);
    return dropped;
  }, []);

  return {
    overlay,
    overlayRef,
    draftSteps,
    draftOutputs,
    outputsStatus,
    hasDraft,
    createOutput,
    editOutput,
    deleteOutput,
    appendOps,
    setConfig,
    setEnabled,
    deleteStep,
    insertStep,
    addLaneStep,
    duplicateStep,
    reorderTrunk,
    discard,
    rebase,
    droppedCount,
    clearDropped,
    staleRestored,
    staleRestoredRef,
  };
}

export type PipelineDraft = ReturnType<typeof usePipelineDraft>;
