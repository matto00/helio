// draftSelection -- HEL-1684 (design.md D6): Save & run answers with the saved definition and no client-id -> id map, so the
// saved step that came from a selected new step is found by walking down from a saved ancestor and matching what the draft made:
// among the saved children (or the root's parentless steps) that were not in the draft as saved steps, the one with the same
// position and kind. Otherwise the nearest saved ancestor, otherwise the first saved step.

import type { PipelineStep } from "../types/pipelineStep";
import type { Step } from "../types/step";
import { isDraftClientId } from "./draftOps";

export function savedStepForDraftStep(
  draftSteps: readonly Step[],
  draftStepId: string,
  saved: readonly PipelineStep[],
): string | undefined {
  const byId = new Map(draftSteps.map((s) => [s.id, s]));
  const known = new Set(draftSteps.filter((s) => !isDraftClientId(s.id)).map((s) => s.id));
  // The chain of new steps from the selected one up to its first saved ancestor (or the root).
  const chain: Step[] = [];
  let cur = byId.get(draftStepId);
  while (cur && isDraftClientId(cur.id)) {
    chain.unshift(cur);
    cur = cur.parentStepId ? byId.get(cur.parentStepId) : undefined;
  }
  let anchor: string | undefined = cur?.id;
  for (const fresh of chain) {
    const candidates = saved.filter(
      (s) =>
        !known.has(s.id) &&
        s.type === fresh.opType.id &&
        (s.position ?? 0) === (fresh.position ?? 0) &&
        (anchor !== undefined
          ? s.parentStepId === anchor
          : !s.parentStepId && s.rootId === fresh.rootId),
    );
    if (candidates.length === 0) return anchor ?? saved[0]?.id;
    anchor = candidates[0].id;
  }
  return anchor ?? saved[0]?.id;
}
