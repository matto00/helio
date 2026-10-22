import { isAxiosError } from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { undoPatchSet } from "../../patchSets/services/patchSetService";
import type { useToast } from "../../toasts/hooks/useToast";
import {
  extractDraftSaveConflict,
  getPipelineWithDefinition,
  saveDraft,
} from "../services/draftSaveService";
import { dismissToast } from "../../toasts/state/toastsSlice";
import { outputsReplaced } from "../state/outputsSlice";
import {
  applyOverlay,
  definitionMatchesBase,
  hasDraft as overlayHasDraft,
  toDraftOutputs,
  toDraftSteps,
} from "../state/pipelineDraft";
import {
  draftSaveRunPending,
  draftSaveRunSettled,
  fetchPipelineById,
  pipelineStepsReplaced,
} from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type {
  DraftCascadeConfirmation,
  DraftRunOutcome,
  DraftSaveCascadeRequired,
  DraftSaveRequest,
  DraftSaveResponse,
} from "../types/draftSave";
import type { Output } from "../types/output";
import type { PipelineRoot, PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import type { PipelineDraft } from "./usePipelineDraft";

/** What the page tells the user about a draft that is not (yet) saved. At most one at a time. */
export type DraftNotice =
  | { kind: "stale" }
  | { kind: "dropped"; count: number }
  | { kind: "error"; message: string; stepName: string | null }
  | { kind: "undoBlocked"; message: string }
  | { kind: "undoNeedsDiscard"; applicationId: string };

export interface DraftCascadePrompt {
  impact: DraftSaveCascadeRequired["impact"];
  /** Names for the ids the server listed, resolved from the page's steps and Outputs. */
  stepNames: string[];
  outputNames: string[];
}

type SaveArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  pushToast: ReturnType<typeof useToast>["push"];
  draft: PipelineDraft;
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
  roots: PipelineRoot[];
  allOutputsRef: MutableRefObject<Output[]>;
  /** Shared with the run stream: true while a Save & run is posted and its response is not yet processed. */
  draftSaveInFlightRef: MutableRefObject<boolean>;
  outputsLoaded: boolean;
  setSseActive: Dispatch<SetStateAction<boolean>>;
  refreshRunHistoryAfterRun: () => void;
  refreshVisibleOutputPreviews: (pipelineId: string, outputIds?: readonly string[]) => void;
  onRunNow: () => void;
};

function runRefusedMessage(run: Extract<DraftRunOutcome, { started: false }>): string {
  const why = run.code === 429 ? "rate limit" : run.reason;
  const retry = run.retryAfterSeconds !== undefined ? `, retry in ${run.retryAfterSeconds} s` : "";
  return `Saved. Run not started: ${why}${retry}`;
}

/** The step the server named in a 400, if its message mentions one of the page's step ids. */
function stepNamedBy(message: string, steps: readonly Step[]): string | null {
  const hit = steps.find((s) => message.includes(s.id));
  return hit ? hit.label : null;
}

/**
 * HEL-1631 (design.md D9-D12): Save & run and its outcomes. Reads the saved definition once, checks the draft's base against
 * it, posts ONE `draft/save` with `runAfterSave: "run"`, then settles: the saved definition replaces the base, the overlay is
 * cleared, and the toast offers Undo. A stale base offers only a reload (owner ruling `reload-only`: there is no overwrite
 * path anywhere here); a 422 asks for cascade confirmation; a refused run is explained after the save, never as a failure.
 */
export function usePipelineDraftSave({
  id,
  dispatch,
  pushToast,
  draft,
  stepsRef,
  setSteps,
  roots,
  allOutputsRef,
  draftSaveInFlightRef,
  outputsLoaded,
  setSseActive,
  refreshRunHistoryAfterRun,
  refreshVisibleOutputPreviews,
  onRunNow,
}: SaveArgs) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [cascade, setCascade] = useState<DraftCascadePrompt | null>(null);
  /** The live "Saved." toast and the application its Undo targets: dismissed once that Undo succeeds or a newer save replaces it. */
  const savedToastRef = useRef<{ toastId: string; applicationId: string } | null>(null);
  const dismissSavedToast = useCallback(() => {
    if (savedToastRef.current) dispatch(dismissToast(savedToastRef.current.toastId));
    savedToastRef.current = null;
  }, [dispatch]);
  const undoneRef = useRef(new Set<string>());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const renderKeys = useCallback(
    (next: PipelineStep[]): Step[] => {
      const keys = new Map<string, string>();
      for (const s of stepsRef.current) if (s.renderKey) keys.set(s.id, s.renderKey);
      return next.map((ps) => {
        const step = pipelineStepToStep(ps);
        const renderKey = keys.get(step.id);
        return renderKey ? { ...step, renderKey } : step;
      });
    },
    [stepsRef],
  );

  /** Makes `definition` the page's saved pipeline (steps, Outputs). */
  const adoptDefinition = useCallback(
    (pipelineId: string, definition: { steps: PipelineStep[]; outputs: Output[] }): Step[] => {
      const next = renderKeys(definition.steps);
      setSteps(next);
      dispatch(pipelineStepsReplaced({ pipelineId, steps: definition.steps }));
      dispatch(outputsReplaced({ pipelineId, outputs: definition.outputs }));
      return next;
    },
    [dispatch, renderKeys, setSteps],
  );

  const undo = useCallback(
    async (applicationId: string) => {
      if (!id) return;
      // One undo per application: a second click (or a stale toast's) can only be refused by the server.
      if (undoneRef.current.has(applicationId)) return;
      try {
        await undoPatchSet(applicationId);
        undoneRef.current.add(applicationId);
        if (savedToastRef.current?.applicationId === applicationId) dismissSavedToast();
        const summary = await getPipelineWithDefinition(id);
        if (!mountedRef.current) return;
        if (summary.definition) adoptDefinition(id, summary.definition);
        draft.discard();
        void dispatch(fetchPipelineById(id));
        pushToast({ variant: "success", message: "Undone." });
      } catch (err: unknown) {
        // Owner ruling `refuse-dependent-restore-rest`: the server's 409 names the panels and alert rules that block the
        // undo and nothing changed; its message is shown as written.
        const message = extractErrorMessage(err, "The undo could not be completed.");
        if (mountedRef.current) setNotice({ kind: "undoBlocked", message });
      }
    },
    [id, adoptDefinition, dismissSavedToast, dispatch, draft, pushToast],
  );

  /** Undo replaces the saved pipeline, which would silently drop a newer draft: with one open, ask first. */
  const requestUndo = useCallback(
    (applicationId: string) => {
      if (overlayHasDraft(draft.overlayRef.current))
        setNotice({ kind: "undoNeedsDiscard", applicationId });
      else void undo(applicationId);
    },
    [draft, undo],
  );

  const settleSaved = useCallback(
    (pipelineId: string, response: DraftSaveResponse) => {
      adoptDefinition(pipelineId, response.saved.definition);
      draft.discard();
      setCascade(null);
      setNotice(null);
      const run = response.run;
      if (run?.started === true) {
        dispatch(draftSaveRunSettled({ pipelineId, outcome: run.status }));
        void dispatch(fetchPipelineById(pipelineId));
        refreshRunHistoryAfterRun();
        refreshVisibleOutputPreviews(
          pipelineId,
          response.saved.definition.outputs.map((o) => o.id),
        );
      } else {
        dispatch(draftSaveRunSettled({ pipelineId, outcome: "refused" }));
        setSseActive(false);
      }
      dismissSavedToast();
      const toastId = pushToast({
        variant: "success",
        message: "Saved.",
        duration: 0,
        action: { label: "Undo", onClick: () => requestUndo(response.saved.applicationId) },
      });
      savedToastRef.current = { toastId, applicationId: response.saved.applicationId };
      if (run !== null && !run.started) {
        pushToast({
          variant: "warning",
          message: runRefusedMessage(run),
          duration: 0,
          action: { label: "Run now", onClick: onRunNow },
        });
      }
    },
    [
      adoptDefinition,
      dismissSavedToast,
      dispatch,
      draft,
      onRunNow,
      pushToast,
      refreshRunHistoryAfterRun,
      refreshVisibleOutputPreviews,
      requestUndo,
      setSseActive,
    ],
  );

  const post = useCallback(
    async (confirm: DraftCascadeConfirmation | undefined) => {
      if (!id || draftSaveInFlightRef.current) return;
      // A draft restored over a pipeline that changed while it was away is never saved over it: reload first.
      if (draft.staleRestoredRef.current) {
        setNotice({ kind: "stale" });
        return;
      }
      draftSaveInFlightRef.current = true;
      setSaving(true);
      setNotice(null);
      let posted = false;
      try {
        const summary = await getPipelineWithDefinition(id);
        const definition = summary.definition;
        if (!definition || summary.fingerprint === undefined) {
          setNotice({
            kind: "error",
            message: "The saved pipeline could not be read.",
            stepName: null,
          });
          return;
        }
        const savedSteps = definition.steps.map(pipelineStepToStep);
        const persisted = stepsRef.current.filter((s) => !/^step-\d+$/.test(s.id));
        const baseOutputs = outputsLoaded ? allOutputsRef.current : null;
        if (
          !definitionMatchesBase(
            { steps: savedSteps, outputs: definition.outputs },
            persisted,
            baseOutputs,
          )
        ) {
          setNotice({ kind: "stale" });
          return;
        }
        const finalSteps = applyOverlay(savedSteps, draft.overlayRef.current);
        const request: DraftSaveRequest = {
          baseFingerprint: summary.fingerprint,
          steps: toDraftSteps(finalSteps),
          outputs: toDraftOutputs(definition.outputs, finalSteps, roots[0]?.id),
          runAfterSave: "run",
          ...(confirm ? { confirmCascade: confirm } : {}),
        };
        dispatch(draftSaveRunPending({ pipelineId: id }));
        setSseActive(true);
        posted = true;
        const response = await saveDraft(id, request);
        if (!mountedRef.current) return;
        posted = false;
        settleSaved(id, response);
      } catch (err: unknown) {
        if (posted) {
          dispatch(draftSaveRunSettled({ pipelineId: id, outcome: "failed" }));
          setSseActive(false);
        }
        if (!mountedRef.current) return;
        const conflict = extractDraftSaveConflict(err);
        if (conflict?.kind === "stale") {
          setNotice({ kind: "stale" });
        } else if (conflict?.kind === "cascadeRequired") {
          const stepName = new Map(stepsRef.current.map((s) => [s.id, s.label]));
          const outputName = new Map(allOutputsRef.current.map((o) => [o.id, o.name]));
          setCascade({
            impact: conflict.impact,
            stepNames: conflict.impact.stepIds.map((s) => stepName.get(s) ?? "A step"),
            outputNames: conflict.impact.outputIds.map((o) => outputName.get(o) ?? "An Output"),
          });
        } else {
          const message = extractErrorMessage(
            err,
            isAxiosError(err) ? "The save was refused." : "The save could not be completed.",
          );
          setNotice({
            kind: "error",
            message,
            stepName: stepNamedBy(message, draft.draftSteps),
          });
        }
      } finally {
        draftSaveInFlightRef.current = false;
        if (mountedRef.current) setSaving(false);
      }
    },
    [
      id,
      allOutputsRef,
      dispatch,
      draft,
      draftSaveInFlightRef,
      outputsLoaded,
      roots,
      setSseActive,
      settleSaved,
      stepsRef,
    ],
  );

  const saveAndRun = useCallback(() => post(undefined), [post]);

  const confirmCascade = useCallback(() => {
    if (!cascade) return Promise.resolve();
    const { impact } = cascade;
    setCascade(null);
    return post({
      stepIds: impact.stepIds,
      outputIds: impact.outputIds,
      panelIds: impact.panelIds,
      alertRuleIds: impact.alertRuleIds,
    });
  }, [cascade, post]);

  const cancelCascade = useCallback(() => setCascade(null), []);

  /** "Reload the saved pipeline": the saved definition becomes the base, the draft is kept as a diff over it. */
  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const summary = await getPipelineWithDefinition(id);
      if (!mountedRef.current || !summary.definition) return;
      const next = adoptDefinition(id, summary.definition);
      const dropped = draft.rebase(next);
      setNotice(dropped > 0 ? { kind: "dropped", count: dropped } : null);
    } catch (err: unknown) {
      setNotice({
        kind: "error",
        message: extractErrorMessage(err, "The saved pipeline could not be reloaded."),
        stepName: null,
      });
    }
  }, [id, adoptDefinition, draft]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  const confirmUndoWithDraft = useCallback(
    (applicationId: string) => {
      setNotice(null);
      draft.discard();
      void undo(applicationId);
    },
    [draft, undo],
  );

  return {
    saving,
    notice: notice === null && draft.staleRestored ? ({ kind: "stale" } as DraftNotice) : notice,
    cascade,
    saveAndRun,
    confirmCascade,
    cancelCascade,
    reload,
    dismissNotice,
    confirmUndoWithDraft,
  };
}

export type PipelineDraftSave = ReturnType<typeof usePipelineDraftSave>;
