import { useEffect } from "react";

import { fetchPipelines } from "../../pipelines/state/pipelinesSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import {
  activateOnboarding,
  hydrateDismissed,
  recordOnboardingComplete,
} from "../state/onboardingSlice";
import {
  allOnboardingStepsComplete,
  deriveCollectionStepStatus,
  derivePanelStepStatus,
  derivePlacementStepStatus,
} from "../state/onboardingSteps";
import { readStoredDismissed, writeStoredDismissed } from "../state/onboardingStorage";

export interface OnboardingHostResult {
  /** `active || autoActivate` — derived, not awaited, so the checklist can
   *  render on the same frame the empty state it supersedes would otherwise
   *  have first painted on (design.md D2). */
  visible: boolean;
}

/** Called UNCONDITIONALLY from `PanelList` — always mounted on `/` — and
 *  never from the checklist component itself, which does not exist in the
 *  state this hook's trigger detects (design.md D3). Owns every Redux side
 *  effect the onboarding surface needs: hydrating/persisting the per-user
 *  dismissal, the sticky auto-activation effect, the sources/pipelines fetch
 *  trigger the host route doesn't already cover, and recording the
 *  all-three-complete dismissal. */
export function useOnboardingHost(): OnboardingHostResult {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const { active, dismissed } = useAppSelector((state) => state.onboarding);
  const dashboards = useAppSelector((state) => state.dashboards);
  const sources = useAppSelector((state) => state.sources);
  const pipelines = useAppSelector((state) => state.pipelines);
  const panels = useAppSelector((state) => state.panels);

  // D7 — hydrate the per-user dismissal once per signed-in user id. Skipped
  // entirely while signed out; re-fires whenever `currentUserId` changes
  // (including null -> id after `onboardingSlice`'s `clearAuth` case resets
  // `dismissed` back to `null` on logout), so a second user on the same
  // browser reads their OWN key rather than inheriting the first user's
  // in-memory value.
  useEffect(() => {
    if (currentUserId === null) return;
    dispatch(hydrateDismissed(readStoredDismissed(currentUserId)));
  }, [dispatch, currentUserId]);

  // D7 — the single owner of the write side too. Skipped while `dismissed`
  // is still the pre-hydration `null` so a fresh mount can't clobber the
  // stored value with one it hasn't actually read yet.
  useEffect(() => {
    if (currentUserId === null || dismissed === null) return;
    writeStoredDismissed(currentUserId, dismissed);
  }, [currentUserId, dismissed]);

  // D3 — a pure derivation off a collection `App.tsx` already fetches
  // unconditionally. `dismissed === false` (not `!dismissed`) so the
  // pre-hydration `null` frame can never satisfy it.
  const autoActivate =
    dashboards.status === "succeeded" && dashboards.items.length === 0 && dismissed === false;
  const visible = active || autoActivate;

  // D2 — visibility is derived above so the checklist paints on the same
  // frame the empty state it supersedes would have; this effect makes THAT
  // frame sticky so it survives `autoActivate` going false the moment the
  // user creates their first dashboard (step 3).
  useEffect(() => {
    if (autoActivate) {
      dispatch(activateOnboarding());
    }
  }, [autoActivate, dispatch]);

  // D3 — fetches the two collections `PanelList`'s host route does not
  // already fetch, whenever the checklist is visible — covers both the
  // auto-activation path and a re-open with a stale/idle collection. Each
  // dispatch is guarded on that collection's own `"idle"` status (the
  // `SourcesPage.tsx:29-37` pattern), so this can't double-fire and an
  // already-loaded collection is left alone.
  useEffect(() => {
    if (!visible) return;
    if (sources.status === "idle") {
      void dispatch(fetchSources());
    }
    if (pipelines.status === "idle") {
      void dispatch(fetchPipelines());
    }
  }, [visible, sources.status, pipelines.status, dispatch]);

  // D10/task 1.12 — reaching all three steps records the dismissal (so a
  // later load doesn't auto-activate) but leaves `active` untouched, so the
  // ticked chain stays on screen instead of vanishing the instant its own
  // completion becomes true. Gated on `visible` too: a returning user who
  // already has all three resources and never opened the checklist at all
  // must not have a dismissal silently recorded on their behalf — the
  // recording is a consequence of the checklist actually being shown, not a
  // background sweep over every account's data.
  useEffect(() => {
    if (!visible || dismissed !== false) return;
    const dashboardStatus = deriveCollectionStepStatus(dashboards.status, dashboards.items.length);
    const panelStatus = derivePanelStepStatus({
      selectedDashboardId: dashboards.selectedDashboardId,
      panels,
    });
    const steps = {
      source: deriveCollectionStepStatus(sources.status, sources.items.length),
      pipeline: deriveCollectionStepStatus(pipelines.status, pipelines.items.length),
      placement: derivePlacementStepStatus(dashboardStatus, panelStatus),
    };
    if (allOnboardingStepsComplete(steps)) {
      dispatch(recordOnboardingComplete());
    }
  }, [visible, dismissed, sources, pipelines, dashboards, panels, dispatch]);

  return { visible };
}
