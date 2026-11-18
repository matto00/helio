import { useCallback } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { outputsReplaced } from "../state/outputsSlice";
import { pipelineRootsReplaced, pipelineStepsReplaced } from "../state/pipelinesSlice";
import { pipelineStepToStep } from "../state/stepNarrowing";
import type { Output } from "../types/output";
import type { PipelineRoot, PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";

/** What a saved definition carries; `roots` when the caller has them (a draft save's response, a read of the pipeline). */
export interface AdoptedDefinition {
  steps: PipelineStep[];
  outputs: Output[];
  roots?: PipelineRoot[];
}

/** Makes a saved definition the page's saved pipeline (steps, Outputs, roots), keeping each step's render key. */
export function usePipelineDraftAdopt({
  dispatch,
  stepsRef,
  setSteps,
}: {
  dispatch: ReturnType<typeof useAppDispatch>;
  stepsRef: MutableRefObject<Step[]>;
  setSteps: Dispatch<SetStateAction<Step[]>>;
}) {
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

  /** Makes `definition` the page's saved pipeline (steps, Outputs, roots). */
  return useCallback(
    (pipelineId: string, definition: AdoptedDefinition): Step[] => {
      const next = renderKeys(definition.steps);
      setSteps(next);
      dispatch(pipelineStepsReplaced({ pipelineId, steps: definition.steps }));
      dispatch(outputsReplaced({ pipelineId, outputs: definition.outputs }));
      if (definition.roots)
        dispatch(pipelineRootsReplaced({ pipelineId, roots: definition.roots }));
      return next;
    },
    [dispatch, renderKeys, setSteps],
  );
}
