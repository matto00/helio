import { useEffect } from "react";

import type { useAppDispatch } from "../../../hooks/reduxHooks";
import { clearRunState } from "../state/pipelinesSlice";
// HEL-878 (task 2.4): dispatched alongside `clearRunState` at every reset call
// site so the run-scoped Output preview cache never drifts out of sync with
// the run-scoped pipeline state -- see `outputsSlice.ts`'s doc comment on the
// reducer itself for the full unification rationale.
import { resetRunScopedState } from "../state/outputsSlice";

/**
 * The run-state reset on pipeline change / unmount extracted from `usePipelineDetailPage`
 * (HEL-1501). Moved verbatim.
 */
export function usePipelineClearRunOnLeave({
  dispatch,
  id,
}: {
  dispatch: ReturnType<typeof useAppDispatch>;
  id: string | undefined;
}) {
  // Clear run state when navigating to a different pipeline
  useEffect(() => {
    return () => {
      dispatch(clearRunState());
      // HEL-878 (task 2.4): navigating away is also run-scoped-state-invalidating
      // -- otherwise a stale preview from pipeline A's last run can leak into
      // pipeline B's rail if B's Outputs happen to share a `stepId`-shaped key.
      dispatch(resetRunScopedState());
    };
  }, [dispatch, id]);
}
