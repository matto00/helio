// Which Output the live column displays, and whether its frame is still catching up with the draft. Both are pure so the
// outer column (which knows the freshest inputs) and the memoised view (which draws the shown ones) agree.

import type { DraftFrames } from "../../hooks/usePipelineDraftFrames";
import type { Output } from "../../types/output";

/** An explicit pick holds only for the step it was made on. */
export interface OutputPick {
  id: string;
  forStep: string | null;
}

/** `picked ?? the Output of the selected step ?? the first Output`. */
export function resolveDisplayedOutput(
  outputs: readonly Output[],
  pick: OutputPick | null,
  selectedStepId: string | null,
): Output | undefined {
  const picked =
    pick !== null && pick.forStep === selectedStepId
      ? outputs.find((o) => o.id === pick.id)
      : undefined;
  return (
    picked ??
    (selectedStepId === null ? undefined : outputs.find((o) => o.nodeStepId === selectedStepId)) ??
    outputs[0]
  );
}

type FrameInputs = Pick<DraftFrames, "views" | "rootRows">;

/**
 * True when the Output's node has a different frame (rows reference or status) in `fresh` than in `shown`: a newer draft
 * frame exists that the view has not rendered yet. Both inputs come from memoised walks, so an unrelated page render
 * leaves them identical and this stays false.
 */
export function isSettling(
  output: Output | undefined,
  fresh: FrameInputs,
  shown: FrameInputs,
): boolean {
  if (output === undefined) return false;
  if (output.nodeStepId === undefined) {
    return (
      output.rootId !== undefined &&
      fresh.rootRows.get(output.rootId) !== shown.rootRows.get(output.rootId)
    );
  }
  const a = fresh.views?.get(output.nodeStepId);
  const b = shown.views?.get(output.nodeStepId);
  return a?.rows !== b?.rows || a?.status !== b?.status;
}
