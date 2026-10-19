// resolveStepParam -- HEL-1668 D1: the `?step=` value is a step id, or the render key of a created step. A created
// step keeps its temp id as its `renderKey` through an AI draft's temp -> server id swap, so a URL still naming that
// temp id resolves to the step too. Shared by the desktop selection (`useStepSelection`) and the phone deep link.
import type { Step } from "../types/step";

/** The id of the step `param` names, or null when `param` is null or names no step. */
export function resolveStepParam(steps: Step[], param: string | null): string | null {
  if (param === null) return null;
  return (
    (steps.find((s) => s.id === param) ?? steps.find((s) => s.renderKey === param))?.id ?? null
  );
}
