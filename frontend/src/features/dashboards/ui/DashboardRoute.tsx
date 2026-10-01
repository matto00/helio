import { Compass } from "lucide-react";
import { useEffect } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { FirstRunRefineBar } from "../../onboarding/ui/FirstRunRefineBar";
import type { FirstRunBuildResult } from "../../onboarding/services/firstRunService";
import { PanelList } from "../../panels/ui/PanelList";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageStatus } from "../../../shared/ui/PageStatus";
import { setSelectedDashboardId } from "../state/dashboardsSlice";

function firstRunResultFor(state: unknown, dashboardId: string): FirstRunBuildResult | null {
  const result = (state as { firstRun?: FirstRunBuildResult } | null)?.firstRun;
  return result && result.dashboardId === dashboardId ? result : null;
}

/** The authenticated `/dashboards/:id` route (HEL-1209): a stable URL to land on after the first
 *  run. Selection stays Redux-only (the sidebar still drives it), so this only selects the routed
 *  dashboard when the id changes or the dashboard first becomes known — never on every selection
 *  change, which would fight the sidebar. The public viewer is the different, longer
 *  `/dashboards/:id/panels`. */
export function DashboardRoute() {
  const { id = "" } = useParams();
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { items, status, error } = useAppSelector((state) => state.dashboards);
  const known = items.some((dashboard) => dashboard.id === id);

  useEffect(() => {
    if (known) dispatch(setSelectedDashboardId(id));
  }, [dispatch, id, known]);

  if (!known && (status === "idle" || status === "loading")) {
    return <PageStatus status="loading" loadingLabel="Loading dashboard" />;
  }
  if (!known && status === "failed") {
    return <PageStatus status="failed" message={error ?? "Failed to load dashboards."} />;
  }
  if (!known) {
    return (
      <EmptyState
        icon={<Compass />}
        title="Dashboard not found"
        description="That dashboard doesn't exist or you don't have access to it."
        cta={{ label: "Back to dashboards", onClick: () => navigate("/") }}
      />
    );
  }

  const firstRun = firstRunResultFor(location.state, id);
  return (
    <>
      {firstRun ? <FirstRunRefineBar result={firstRun} /> : null}
      <PanelList />
    </>
  );
}
