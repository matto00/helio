import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { getSessionEpoch } from "../../../shared/session/sessionEpoch";
import { extractErrorMessage } from "../../../services/extractErrorMessage";
import { undoPatchSet } from "../../patchSets/services/patchSetService";
import type { useToast } from "../../toasts/hooks/useToast";
import { dismissToast } from "../../toasts/state/toastsSlice";
import { getPipelineWithDefinition } from "../services/draftSaveService";
import { hasDraft as overlayHasDraft } from "../state/pipelineDraft";
import { fetchPipelineById } from "../state/pipelinesSlice";
import type { Step } from "../types/step";
import type { DraftNotice } from "./draftSaveRequest";
import type { PipelineDraft } from "./usePipelineDraft";
import type { AdoptedDefinition } from "./usePipelineDraftAdopt";

/** The live "Saved." toast and the Undo of the save it announces; `requestUndo` and `confirmUndoWithDraft` are the page's two entry points. */
export function usePipelineDraftUndo({
  id,
  dispatch,
  draft,
  pushToast,
  mountedRef,
  setNotice,
  adoptDefinition,
}: {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  draft: PipelineDraft;
  pushToast: ReturnType<typeof useToast>["push"];
  mountedRef: MutableRefObject<boolean>;
  setNotice: (notice: DraftNotice | null) => void;
  adoptDefinition: (pipelineId: string, definition: AdoptedDefinition) => Step[];
}) {
  /** The live "Saved." toast and the application its Undo targets: dismissed once that Undo succeeds or a newer save replaces it. */
  const savedToastRef = useRef<{ toastId: string; applicationId: string } | null>(null);
  const dismissSavedToast = useCallback(() => {
    if (savedToastRef.current) dispatch(dismissToast(savedToastRef.current.toastId));
    savedToastRef.current = null;
  }, [dispatch]);
  const undoneRef = useRef(new Set<string>());

  const undo = useCallback(
    async (applicationId: string) => {
      if (!id) return;
      // One undo per application: a second click (or a stale toast's) can only be refused by the server.
      if (undoneRef.current.has(applicationId)) return;
      // HEL-1810: nothing after an await below runs under a session other than the one that asked for the undo.
      const startEpoch = getSessionEpoch();
      try {
        await undoPatchSet(applicationId);
        if (getSessionEpoch() !== startEpoch) return;
        undoneRef.current.add(applicationId);
        if (savedToastRef.current?.applicationId === applicationId) dismissSavedToast();
        const summary = await getPipelineWithDefinition(id);
        if (getSessionEpoch() !== startEpoch) return;
        if (!mountedRef.current) return;
        if (summary.definition)
          adoptDefinition(id, { ...summary.definition, roots: summary.roots });
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
    [id, adoptDefinition, dismissSavedToast, dispatch, draft, mountedRef, pushToast, setNotice],
  );

  /** Undo replaces the saved pipeline, which would silently drop a newer draft: with one open, ask first. */
  const requestUndo = useCallback(
    (applicationId: string) => {
      if (overlayHasDraft(draft.overlayRef.current))
        setNotice({ kind: "undoNeedsDiscard", applicationId });
      else void undo(applicationId);
    },
    [draft, setNotice, undo],
  );

  const confirmUndoWithDraft = useCallback(
    (applicationId: string) => {
      setNotice(null);
      draft.discard();
      void undo(applicationId);
    },
    [draft, setNotice, undo],
  );

  return { savedToastRef, dismissSavedToast, requestUndo, confirmUndoWithDraft };
}
