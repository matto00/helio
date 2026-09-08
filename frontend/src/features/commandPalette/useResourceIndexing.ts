import { useEffect, useRef } from "react";
import { createSelector } from "@reduxjs/toolkit";

import { useAppDispatch, useAppSelector } from "../../hooks/reduxHooks";
import type { RootState } from "../../store/store";
import { fetchDashboards } from "../dashboards/state/dashboardsSlice";
import { fetchAllOutputs } from "../pipelines/state/outputsSlice";
import { fetchPipelines } from "../pipelines/state/pipelinesSlice";
import { fetchSources } from "../sources/state/sourcesSlice";
import { useCommandPalette } from "./hooks";
import type { AsyncStatus } from "../pipelines/state/outputsSlice";

/** design.md D2 — coverage status per kind, read by `useResourceSearchActions` too so the
 * coverage caveat and the indexing effect agree on exactly the same four statuses. */
export interface IndexStatuses {
  dashboard: AsyncStatus;
  source: AsyncStatus;
  pipeline: AsyncStatus;
  output: AsyncStatus;
}

// `createSelector` memoizes on its four scalar inputs, so this returns the SAME object
// reference across renders where none of the four statuses changed — a plain inline selector
// would allocate a fresh object every call and defeat `useSelector`'s reference-equality check,
// triggering React-Redux's "selector returned a different result" warning on every render.
const selectIndexStatuses = createSelector(
  [
    (state: RootState) => state.dashboards.status,
    (state: RootState) => state.sources.status,
    (state: RootState) => state.pipelines.status,
    (state: RootState) => state.outputs.allStatus,
  ],
  (dashboard, source, pipeline, output): IndexStatuses => ({ dashboard, source, pipeline, output }),
);

export function useIndexStatuses(): IndexStatuses {
  return useAppSelector(selectIndexStatuses);
}

/**
 * HEL-503 design.md D2 (owner ruling) — indexes all four kinds EXPLICITLY, on palette open, so
 * search works on `/` with no prior navigation. `/` fetches only dashboards at boot
 * (`App.tsx:174`); sources/pipelines are gated on pathname (`SidebarBody.tsx:53-66`) and outputs
 * are otherwise only fetched per-pipeline inside `PipelineDetailPage` — none of the three are
 * loaded on `/` by anything else UNLESS the onboarding checklist is also visible (a
 * zero-dashboard account; `useOnboardingHost.ts:83-91`), which is exactly why every `/`-route
 * test for this ticket must start from an account that already has a dashboard.
 *
 * The guard reads each slice's OWN status (`IndexStatuses`), never a thunk's `condition` option
 * — `fetchPipelines` happens to have one, `fetchSources`/`fetchDashboards`/`fetchAllOutputs` do
 * not, and asserting "at most once" against the wrong mechanism is how that test goes vacuous
 * (round-1 CR3). `failed` retries on the NEXT palette open (one retry per explicit user action,
 * no backoff loop, no background polling) — `loading` and `succeeded` are left alone.
 *
 * This effect fires ONLY on the `isOpen` open-EDGE (`false` -> `true`), not on every status
 * change. `statuses` is deliberately absent from the dependency array and read at the moment the
 * edge fires via `latestStatuses` — a `loading`/`failed` status naturally changes again the
 * instant the dispatched thunk settles, and a naive effect keyed on `statuses` too would treat
 * that settlement as a fresh reason to re-run, re-dispatching on every `failed` transition while
 * the SAME palette session stays open: an unbounded retry loop, not "one retry per explicit
 * open" (caught by this exact symptom in `CommandPalette.test.tsx` before this fix — hundreds of
 * requests fired for a single render).
 */
export function useResourceIndexing(): void {
  const dispatch = useAppDispatch();
  const { isOpen } = useCommandPalette();
  const statuses = useIndexStatuses();
  const latestStatuses = useRef(statuses);
  useEffect(() => {
    latestStatuses.current = statuses;
  }, [statuses]);

  useEffect(() => {
    if (!isOpen) return;
    const current = latestStatuses.current;
    if (current.dashboard === "idle" || current.dashboard === "failed") {
      void dispatch(fetchDashboards());
    }
    if (current.source === "idle" || current.source === "failed") {
      void dispatch(fetchSources());
    }
    if (current.pipeline === "idle" || current.pipeline === "failed") {
      void dispatch(fetchPipelines());
    }
    if (current.output === "idle" || current.output === "failed") {
      void dispatch(fetchAllOutputs());
    }
    // Deliberately keyed on `isOpen` ONLY — see the docblock above.
  }, [isOpen, dispatch]);
}
