// useStepSelection -- HEL-1579 (design.md D6): which step the desktop page is editing/previewing.
// The selection lives in the URL search param `step` (written with `replace`, so it does not spam
// history), coexisting with `?outputId=`: every write uses the functional `setSearchParams(prev => ...)`
// form so one param never clobbers the other.
//
// Rules: default = first step of root 0's trunk lane (none when there are no steps); an unknown
// `?step=` falls back to the default; a step that appears after the first load (add / insert /
// branch / duplicate / shape, and the temp-id -> server-id swap of a created step) becomes selected;
// removing the selected step selects its predecessor in the same lane, else the parent step, else
// the first step (`selectAfterRemoval`).

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { LaneGraph } from "../state/stepTree";
import type { Step } from "../types/step";

export const STEP_PARAM = "step";

/** First step of the first root's trunk lane, or `undefined` when there are no steps. */
export function defaultSelectedStepId(
  laneGraph: LaneGraph,
  firstRootId: string | undefined,
): string | undefined {
  const trunk = laneGraph.lanes.find(
    (l) => l.parentStepId === undefined && l.rootId === firstRootId,
  );
  return trunk?.steps[0]?.id ?? laneGraph.lanes.find((l) => l.steps.length > 0)?.steps[0]?.id;
}

/** The step to select once `removedId` is gone: its predecessor in its own lane, else the step its
 *  lane branches from, else the default first step (never the removed one). */
export function selectAfterRemoval(
  laneGraph: LaneGraph,
  removedId: string,
  firstRootId: string | undefined,
): string | undefined {
  const lane = laneGraph.lanes.find((l) => l.id === laneGraph.laneOfStepId[removedId]);
  if (lane) {
    const index = lane.steps.findIndex((s) => s.id === removedId);
    if (index > 0) return lane.steps[index - 1].id;
    if (lane.parentStepId !== undefined) return lane.parentStepId;
  }
  const fallback = defaultSelectedStepId(laneGraph, firstRootId);
  if (fallback !== removedId) return fallback;
  // The removed step was the default: the first remaining step anywhere.
  return laneGraph.lanes.flatMap((l) => l.steps).find((s) => s.id !== removedId)?.id;
}

/** Which step appeared since the previous committed step list (HEL-1582 extracted this from `useStepSelection` so the
 *  phone's step sheet and the desktop selection share one detector). Tracked in state, adjusted during render, so the
 *  very render that swaps a created step's temp id for its server id already knows the new id (no transient
 *  fallback to the default step, which would remount the editor and fetch the wrong preview).
 *
 *  `addedStepId` is the last id added by the latest list change (`null` when that change added none, or while the
 *  steps are not loaded); `change` is a stable object identity per list change, for an effect to key on. */
export function useAddedStepId(steps: Step[], stepsLoaded: boolean) {
  const idsKey = steps.map((s) => s.id).join("|");
  const [seen, setSeen] = useState<{ key: string; ids: Set<string>; added: string[] } | null>(null);
  if (stepsLoaded && (seen === null || seen.key !== idsKey)) {
    setSeen({
      key: idsKey,
      ids: new Set(steps.map((s) => s.id)),
      // The first loaded list is the baseline, never "created".
      added: seen === null ? [] : steps.filter((s) => !seen.ids.has(s.id)).map((s) => s.id),
    });
  }
  const addedStepId = seen !== null && seen.key === idsKey ? (seen.added.at(-1) ?? null) : null;
  return { addedStepId, change: seen };
}

export function useStepSelection(args: {
  steps: Step[];
  laneGraph: LaneGraph;
  firstRootId: string | undefined;
  /** False while the steps fetch is in flight or failed: the first loaded list never counts as "created". */
  stepsLoaded: boolean;
}) {
  const { steps, laneGraph, firstRootId, stepsLoaded } = args;
  const [searchParams, setSearchParams] = useSearchParams();
  const urlStep = searchParams.get(STEP_PARAM);

  const { addedStepId: lastAdded, change: seen } = useAddedStepId(steps, stepsLoaded);

  const defaultId = defaultSelectedStepId(laneGraph, firstRootId);
  // A created step keeps its temp id as its `renderKey` through an AI draft's swap, so a URL still naming that
  // temp id resolves to the step too.
  const urlStepId =
    urlStep === null
      ? null
      : ((steps.find((s) => s.id === urlStep) ?? steps.find((s) => s.renderKey === urlStep))?.id ??
        null);
  const selectedStepId = urlStepId ?? lastAdded ?? defaultId ?? null;

  const selectStep = useCallback(
    (stepId: string | null) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (stepId === null) next.delete(STEP_PARAM);
          else next.set(STEP_PARAM, stepId);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // A step that appears after the first load is a created one: write it to the URL once its id exists.
  useEffect(() => {
    if (seen !== null && seen.added.length > 0) selectStep(seen.added[seen.added.length - 1]);
  }, [seen, selectStep]);

  return { selectedStepId, selectStep };
}
