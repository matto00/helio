import { useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { fetchDashboards } from "../../dashboards/services/dashboardService";
import { dashboardUpserted, setSelectedDashboardId } from "../../dashboards/state/dashboardsSlice";
import { fetchSources } from "../../sources/state/sourcesSlice";
import { track } from "../../telemetry/track";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { buildTemplateDashboard } from "../services/firstRunService";
import { describeFirstRunError } from "../state/firstRunErrors";
import { dismissOnboarding } from "../state/onboardingSlice";
import type { FirstRunState } from "./useFirstRunBuild";

export const TEMPLATE_STAGE_LABEL = "Loading sample data and building your dashboard…";

export interface FirstRunTemplate {
  state: FirstRunState;
  choose: (slug: string) => void;
  /** Re-runs the last chosen template. */
  retry: () => void;
  canRetry: boolean;
}

/** Persona-chip flow (HEL-1210): `POST /api/first-run/template` -> refresh the dashboards list ->
 *  navigate to `/dashboards/:id`, mirroring [`useFirstRunBuild`]'s landing behaviour. The server
 *  creates and owns the sample source, so a failed attempt leaves nothing to clean up client-side. */
export function useFirstRunTemplate(): FirstRunTemplate {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [state, setState] = useState<FirstRunState>({ status: "idle" });
  const lastSlug = useRef<string | null>(null);
  const inFlight = useRef(false);

  const run = useCallback(
    async (slug: string) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState({ status: "working", stage: "building" });
      try {
        const result = await buildTemplateDashboard(slug);
        const dashboards = await fetchDashboards();
        const landed = dashboards.find((d) => d.id === result.dashboardId);
        if (landed) dispatch(dashboardUpserted(landed));
        void dispatch(fetchSources());
        dispatch(setSelectedDashboardId(result.dashboardId));
        dispatch(dismissOnboarding());
        track("firstrun_dashboard_created", { panelCount: result.panelCount });
        lastSlug.current = null;
        navigate(`/dashboards/${result.dashboardId}`, { state: { firstRun: result } });
      } catch (err) {
        setState({ status: "error", message: describeFirstRunError(err, "building") });
      } finally {
        inFlight.current = false;
      }
    },
    [dispatch, navigate],
  );

  const choose = useCallback(
    (slug: string) => {
      if (inFlight.current) return;
      lastSlug.current = slug;
      track("firstrun_template_chosen", { template: slug });
      void run(slug);
    },
    [run],
  );

  const retry = useCallback(() => {
    if (lastSlug.current) void run(lastSlug.current);
  }, [run]);

  return { state, choose, retry, canRetry: lastSlug.current !== null };
}
