import { isTempStepId, isUnsupportedOpType } from "../state/stepNarrowing";
import type { PipelineStepConfig } from "../types/pipelineStep";
import type { Step } from "../types/step";

type UseStepCardPersistArgs = {
  step: Step;
  /** Receives every edit synchronously. On the pipeline page it writes the edit into the client-only draft (HEL-1631), so
   *  nothing is sent to the server until Save & run. */
  onConfigChange: (stepId: string, config: PipelineStepConfig) => void;
};

/**
 * HEL-1631 (design.md D6): the editor no longer writes to the server. `persist` hands the edited config to the page, which
 * keeps it in the draft; there is no debounce, no PATCH, no cache invalidation and no flush on unmount. The name is kept
 * because the field and op handlers call it for every edit.
 */
export function useStepCardPersist({ step, onConfigChange }: UseStepCardPersistArgs) {
  function persist(newConfig: PipelineStepConfig): void {
    // HEL-1100: an unsupported step kind has no config editor that could have produced a real edit.
    if (isUnsupportedOpType(step.opType)) return;
    // HEL-1109: a step still carrying its `makeStep`-minted temp id has no server row; its edits flow through
    // `emitOrPersist` (the deferred-create path), never as a draft entry.
    if (isTempStepId(step.id)) return;
    onConfigChange(step.id, newConfig);
  }

  /** HEL-1109 (design.md D3): a not-yet-created draft (temp id) still reports every edit to the page immediately, which
   *  fires its exactly-once create the moment its config is complete; a saved step's edit goes into the draft. */
  function emitOrPersist(newConfig: PipelineStepConfig) {
    if (isTempStepId(step.id)) {
      onConfigChange(step.id, newConfig);
      return;
    }
    persist(newConfig);
  }

  return { persist, emitOrPersist };
}
