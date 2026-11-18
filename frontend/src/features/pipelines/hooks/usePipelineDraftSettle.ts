import { useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import type { useToast } from "../../toasts/hooks/useToast";
import { isDraftClientId } from "../state/draftOps";
import { remapCreatedOutputs, savedStepForDraftStep } from "../state/draftSelection";
import { draftSaveRunSettled, fetchPipelineById } from "../state/pipelinesSlice";
import type { DraftSaveResponse } from "../types/draftSave";
import type { Output } from "../types/output";
import type { Step } from "../types/step";
import { runRefusedMessage } from "./draftSaveRequest";
import type { DraftCascadePrompt, DraftNotice } from "./draftSaveRequest";
import type { PipelineDraft } from "./usePipelineDraft";
import type { AdoptedDefinition } from "./usePipelineDraftAdopt";
import { STEP_PARAM } from "./useStepSelection";

/** What happens after a Save & run response: the saved definition replaces the base, the overlay is cleared, the toast offers Undo. */
export function usePipelineDraftSettle({
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
}: {
  draft: PipelineDraft;
  dispatch: ReturnType<typeof useAppDispatch>;
  pushToast: ReturnType<typeof useToast>["push"];
  adoptDefinition: (pipelineId: string, definition: AdoptedDefinition) => Step[];
  allOutputsRef: MutableRefObject<Output[]>;
  setOutputPickRemap: Dispatch<SetStateAction<ReadonlyMap<string, string>>>;
  dismissSavedToast: () => void;
  savedToastRef: MutableRefObject<{ toastId: string; applicationId: string } | null>;
  requestUndo: (applicationId: string) => void;
  setCascade: Dispatch<SetStateAction<DraftCascadePrompt | null>>;
  setNotice: Dispatch<SetStateAction<DraftNotice | null>>;
  setSseActive: Dispatch<SetStateAction<boolean>>;
  refreshRunHistoryAfterRun: () => void;
  refreshVisibleOutputPreviews: (pipelineId: string, outputIds?: readonly string[]) => void;
  onRunNow: () => void;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const stepParamRef = useRef<string | null>(null);
  // Moved verbatim (HEL-1704) from `usePipelineDraftSave`, which the React Compiler lint rule skipped; the render-time write is the
  // behaviour being preserved, so the rule is waived here rather than moving the write into an effect.
  // eslint-disable-next-line react-hooks/refs
  stepParamRef.current = searchParams.get(STEP_PARAM);

  return useCallback(
    (pipelineId: string, response: DraftSaveResponse) => {
      // A selected new step has no saved id until now: keep the selection (and `?step=`) on the saved step it became (D6).
      const selected = stepParamRef.current;
      if (selected !== null && isDraftClientId(selected)) {
        const savedId = savedStepForDraftStep(
          draft.draftSteps,
          selected,
          response.saved.definition.steps,
        );
        setSearchParams(
          (prev) => {
            const next = new URLSearchParams(prev);
            if (savedId === undefined) next.delete(STEP_PARAM);
            else next.set(STEP_PARAM, savedId);
            return next;
          },
          { replace: true },
        );
      }
      // An explicit pick of an Output this draft created follows it to the saved Output it became (D10).
      setOutputPickRemap(
        remapCreatedOutputs(
          draft.draftSteps,
          draft.draftOutputs,
          new Set(allOutputsRef.current.map((o) => o.id)),
          response.saved.definition.steps,
          response.saved.definition.outputs,
        ),
      );
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
      allOutputsRef,
      setOutputPickRemap,
      dismissSavedToast,
      dispatch,
      draft,
      onRunNow,
      pushToast,
      refreshRunHistoryAfterRun,
      refreshVisibleOutputPreviews,
      requestUndo,
      savedToastRef,
      setCascade,
      setNotice,
      setSearchParams,
      setSseActive,
    ],
  );
}
