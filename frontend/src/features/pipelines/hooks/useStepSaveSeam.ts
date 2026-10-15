import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";

import { usePendingStepSaves } from "../state/stepSaveContext";
import type { StepSaveContextValue } from "../state/stepSaveContext";
import type { Step } from "../types/step";

/**
 * HEL-1579 (design.md D7/D8): the desktop page's side of `StepSaveContext` -- the pending-saves
 * tracker, the "does this step still exist" probe used by the unmount flush, and the page-level
 * `stepSaveErrors` map a failed flushed save reports into (cleared on that step's next successful
 * save). `steps` is mirrored into a ref in a LAYOUT effect, which runs before the passive unmount
 * cleanup of the editor that is flushing, so a step removed in the same commit reads as gone.
 */
export function useStepSaveSeam(steps: Step[]) {
  const tracker = usePendingStepSaves();
  const stepsRef = useRef(steps);
  useLayoutEffect(() => {
    stepsRef.current = steps;
  }, [steps]);

  const [stepSaveErrors, setStepSaveErrors] = useState<Record<string, string>>({});
  const reportSaveError = useCallback((stepId: string, message: string | null) => {
    setStepSaveErrors((prev) => {
      if (message === null) {
        if (!(stepId in prev)) return prev;
        const next = { ...prev };
        delete next[stepId];
        return next;
      }
      return prev[stepId] === message ? prev : { ...prev, [stepId]: message };
    });
  }, []);

  const isStepPresent = useCallback(
    (stepId: string) => stepsRef.current.some((s) => s.id === stepId),
    [],
  );

  const contextValue = useMemo<StepSaveContextValue>(
    () => ({ tracker, isStepPresent, reportSaveError }),
    [tracker, isStepPresent, reportSaveError],
  );
  return { contextValue, tracker, stepSaveErrors };
}
