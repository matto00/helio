import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  previewOutput,
  resetRunScopedState,
  selectOutputsForPipeline,
} from "../state/outputsSlice";
import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { usePipelineRunEvents } from "./usePipelineRunEvents";
import type { RunStatusEventData } from "./usePipelineRunEvents";
import type { useRunHistory } from "./useRunHistory";

type UsePipelineRunStreamArgs = {
  id: string | undefined;
  dispatch: ReturnType<typeof useAppDispatch>;
  sseActive: boolean;
  setSseActive: Dispatch<SetStateAction<boolean>>;
  /** True from the moment a Save & run is posted until its response has been processed. */
  draftSaveInFlightRef: MutableRefObject<boolean>;
  refreshRunHistoryAfterRun: ReturnType<typeof useRunHistory>["refreshRunHistoryAfterRun"];
};

/**
 * The run-status SSE subscription extracted from `usePipelineDetailPage` (HEL-1478 D3, C5): the
 * `usePipelineRunEvents` call with its terminal handler, which resets the run-scoped Output
 * previews, re-fetches every known Output's preview and refreshes run history.
 */
export function usePipelineRunStream({
  id,
  dispatch,
  sseActive,
  setSseActive,
  draftSaveInFlightRef,
  refreshRunHistoryAfterRun,
}: UsePipelineRunStreamArgs) {
  const sseData = usePipelineRunEvents({
    pipelineId: id,
    active: sseActive,
    onTerminal: (event: RunStatusEventData) => {
      setSseActive(false);
      // HEL-878 (task 2.4): the SSE half of the single-reset-path unification --
      // covers a run that was already in flight when this page mounted (the
      // submitPipelineRun.pending reset in outputsSlice only fires for a run
      // started from THIS page). Every rail/sheet preview is stale the moment
      // the run finishes.
      dispatch(resetRunScopedState());
      // HEL-908 Cycle 13 -- resetting the cache alone leaves every rail chip
      // showing "-" until its own sheet is reopened (`OutputsRail` is
      // presentational-only and never fetches on its own -- see its file
      // doc comment). Re-fetch every currently-known Output's preview right
      // away so the chips repopulate as soon as the run actually finishes,
      // without requiring the user to reopen anything. A failed run leaves
      // the reset cache empty (nothing to show) rather than re-fetching
      // against rows that a failed run may not have touched. `dry_run` is
      // its own terminal status (see `usePipelineRunEvents.ts`'s
      // `TERMINAL_STATUSES`), distinct from `succeeded` -- a dry run must
      // refresh the rail exactly like a live run does (design.md decision 2
      // draws no rail-thumbnail distinction between the two).
      // A Save & run's run can finish before the save's response is processed, while this page still holds the pre-save
      // Output list: an Output the save removed would be requested (a 404). The save refreshes the previews from its own
      // saved definition when it settles, so nothing is lost by skipping them here.
      if (
        id &&
        !draftSaveInFlightRef.current &&
        (event.status === "succeeded" || event.status === "dry_run")
      ) {
        // The ids come from the store at this moment, not from a render's ref: `outputsReplaced` may have landed after
        // the last commit, and a ref would still hold an Output the save removed.
        dispatch((_dispatch, getState) => {
          for (const output of selectOutputsForPipeline(getState(), id)) {
            void dispatch(previewOutput({ pipelineId: id, outputId: output.id }));
          }
        });
      }
      refreshRunHistoryAfterRun();
      // HEL-242's DataType-row-invalidation dispatch (`markDataTypeRowsStale`)
      // was removed here as evaluation-1 cycle-2 CR3: the backend no longer
      // serves `outputDataTypeId` on `PipelineSummaryResponse` (that field is
      // gone), so `currentPipeline?.outputDataTypeId` was permanently
      // `undefined` and the dispatch was unreachable dead code.
    },
  });
  return sseData;
}
