import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import type { useToast } from "../../toasts/hooks/useToast";
import { getPipelineWithDefinition, saveDraft } from "../services/draftSaveService";
import { draftSaveRunPending, draftSaveRunSettled } from "../state/pipelinesSlice";
import type { DraftCascadeConfirmation } from "../types/draftSave";
import type { Output } from "../types/output";
import type { PipelineRoot } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { buildDraftSaveRequest, noticeForSaveError } from "./draftSaveRequest";
import { overlayHasOutputChange } from "../state/pipelineDraft";
import type { DraftCascadePrompt, DraftNotice } from "./draftSaveRequest";
import type { PipelineDraft } from "./usePipelineDraft";
import { usePipelineDraftAdopt } from "./usePipelineDraftAdopt";
import { usePipelineDraftSettle } from "./usePipelineDraftSettle";
import { usePipelineDraftUndo } from "./usePipelineDraftUndo";
import type { PipelineRunRole } from "./usePipelineRunRole";

export type { DraftCascadePrompt, DraftNotice };

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
  setOutputPickRemap: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
  outputsLoaded: boolean;
  setSseActive: Dispatch<SetStateAction<boolean>>;
  refreshRunHistoryAfterRun: () => void;
  refreshVisibleOutputPreviews: (pipelineId: string, outputIds?: readonly string[]) => void;
  onRunNow?: () => void;
  /** HEL-1661: a viewer cannot run, so Save & run and its cascade confirmation return early for one. */
  runRole?: PipelineRunRole;
};

/**
 * HEL-1631 (design.md D9-D12): Save & run and its outcomes. Reads the saved definition once, checks the draft's base against
 * it, posts ONE `draft/save` with `runAfterSave: "run"`, then settles: the saved definition replaces the base, the overlay is
 * cleared, and the toast offers Undo. A stale base offers only a reload (owner ruling `reload-only`: there is no overwrite
 * path anywhere here); a 422 asks for cascade confirmation; a refused run is explained after the save, never as a failure.
 * HEL-1704: the request building and error mapping live in `draftSaveRequest`, adopt/undo/settle in their own hooks.
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
  setOutputPickRemap,
  outputsLoaded,
  setSseActive,
  refreshRunHistoryAfterRun,
  refreshVisibleOutputPreviews,
  onRunNow,
  runRole,
}: SaveArgs) {
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<DraftNotice | null>(null);
  const [cascade, setCascade] = useState<DraftCascadePrompt | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { droppedCount, clearDropped } = draft;
  useEffect(() => {
    if (droppedCount === 0) return;
    setNotice({ kind: "dropped", count: droppedCount });
    clearDropped();
  }, [droppedCount, clearDropped]);

  const adoptDefinition = usePipelineDraftAdopt({ dispatch, stepsRef, setSteps });
  const { savedToastRef, dismissSavedToast, requestUndo, confirmUndoWithDraft } =
    usePipelineDraftUndo({
      id,
      dispatch,
      draft,
      pushToast,
      mountedRef,
      setNotice,
      adoptDefinition,
    });
  const settleSaved = usePipelineDraftSettle({
    draft,
    dispatch,
    pushToast,
    adoptDefinition,
    allOutputsRef,
    setOutputPickRemap,
    dismissSavedToast,
    savedToastRef,
    requestUndo,
    setCascade,
    setNotice,
    setSseActive,
    refreshRunHistoryAfterRun,
    refreshVisibleOutputPreviews,
    onRunNow,
  });

  const post = useCallback(
    async (confirm: DraftCascadeConfirmation | undefined) => {
      if (!id || draftSaveInFlightRef.current) return;
      // A draft restored over a pipeline that changed while it was away is never saved over it: reload first.
      if (draft.staleRestoredRef.current) {
        setNotice({ kind: "stale" });
        return;
      }
      // Output ops are never judged against an Output list this page has not loaded (D15): refuse, and say why.
      if (!outputsLoaded && overlayHasOutputChange(draft.overlayRef.current)) {
        setNotice({
          kind: "error",
          message: "Outputs could not be loaded; reload to save this draft",
          stepName: null,
        });
        return;
      }
      draftSaveInFlightRef.current = true;
      setSaving(true);
      setNotice(null);
      let posted = false;
      try {
        const summary = await getPipelineWithDefinition(id);
        const built = buildDraftSaveRequest({
          summary,
          persistedSteps: stepsRef.current.filter((s) => !/^step-\d+$/.test(s.id)),
          baseOutputs: outputsLoaded ? allOutputsRef.current : null,
          overlay: draft.overlayRef.current,
          roots,
          confirm,
        });
        if (built.kind === "unreadable") {
          setNotice({
            kind: "error",
            message: "The saved pipeline could not be read.",
            stepName: null,
          });
          return;
        }
        if (built.kind === "stale") {
          setNotice({ kind: "stale" });
          return;
        }
        if (built.kind === "dropped") {
          setNotice({ kind: "dropped", count: built.count });
          return;
        }
        dispatch(draftSaveRunPending({ pipelineId: id }));
        setSseActive(true);
        posted = true;
        const response = await saveDraft(id, built.request);
        if (!mountedRef.current) return;
        posted = false;
        settleSaved(id, response);
      } catch (err: unknown) {
        if (posted) {
          dispatch(draftSaveRunSettled({ pipelineId: id, outcome: "failed" }));
          setSseActive(false);
        }
        if (!mountedRef.current) return;
        const mapped = noticeForSaveError(err, {
          steps: stepsRef.current,
          outputs: allOutputsRef.current,
          draftSteps: draft.draftSteps,
          draftOutputs: draft.draftOutputs,
          roots,
        });
        if ("cascade" in mapped) setCascade(mapped.cascade);
        else setNotice(mapped.notice);
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

  const saveAndRun = useCallback(
    () => (runRole === "viewer" ? Promise.resolve() : post(undefined)),
    [post, runRole],
  );

  const confirmCascade = useCallback(() => {
    if (!cascade || runRole === "viewer") return Promise.resolve();
    const { impact } = cascade;
    setCascade(null);
    return post({
      stepIds: impact.stepIds,
      outputIds: impact.outputIds,
      panelIds: impact.panelIds,
      alertRuleIds: impact.alertRuleIds,
      rootIds: impact.rootIds,
    });
  }, [cascade, post, runRole]);

  const cancelCascade = useCallback(() => setCascade(null), []);

  /** "Reload the saved pipeline": the saved definition becomes the base, the draft is kept as a diff over it. */
  const reload = useCallback(async () => {
    if (!id) return;
    try {
      const summary = await getPipelineWithDefinition(id);
      if (!mountedRef.current || !summary.definition) return;
      const definition = summary.definition;
      const next = adoptDefinition(id, { ...definition, roots: summary.roots });
      const dropped = draft.rebase(next, outputsLoaded ? definition.outputs : null, summary.roots);
      setNotice(dropped > 0 ? { kind: "dropped", count: dropped } : null);
    } catch (err: unknown) {
      setNotice({
        kind: "error",
        message: extractErrorMessage(err, "The saved pipeline could not be reloaded."),
        stepName: null,
      });
    }
  }, [id, adoptDefinition, draft, outputsLoaded]);

  const dismissNotice = useCallback(() => setNotice(null), []);

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
