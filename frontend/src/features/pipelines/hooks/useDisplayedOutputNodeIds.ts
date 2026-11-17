import { useMemo } from "react";

import {
  resolveDisplayedOutput,
  type OutputPick,
} from "../state/liveOutput/resolveDisplayedOutput";
import type { Output } from "../types/output";

const NONE: readonly string[] = [];

/**
 * HEL-1705 (design.md D3): the step id of the Output the live column displays, as the list the draft request is built from.
 * The layout resolves it with its own fresh selection (the column resolves the same Output from its coalesced one), so the
 * one paced draft-preview request also asks for the displayed Output's rows. The array is stable while the id is.
 */
export function useDisplayedOutputNodeIds(
  outputs: readonly Output[],
  pick: OutputPick | null,
  selectedStepId: string | null,
  /** HEL-1733: the Output editor sheet's node while it is open, so its draft rows ride on the same request. */
  sheetNodeStepId?: string,
  remap?: ReadonlyMap<string, string>,
): readonly string[] {
  const nodeStepId = resolveDisplayedOutput(outputs, pick, selectedStepId, remap)?.nodeStepId;
  return useMemo(() => {
    const ids = [nodeStepId, sheetNodeStepId].filter(
      (id, i, all): id is string => id !== undefined && all.indexOf(id) === i,
    );
    return ids.length === 0 ? NONE : ids;
  }, [nodeStepId, sheetNodeStepId]);
}
