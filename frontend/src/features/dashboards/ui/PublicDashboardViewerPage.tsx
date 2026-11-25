// HEL-590 CR1 -- the page a minted share link actually lands on: a public, unauthenticated
// read-only view of a dashboard's panels, reached via `?token=`.
//
// THE DENIAL PATH IS THE MOST IMPORTANT PART OF THIS COMPONENT. The backend's
// `authorizeResourceWithSharing` already makes an expired, revoked, nonexistent, or
// wrong-resource token return a byte-identical 404 (AclDirective design D4) -- this component
// MUST NOT undo that by rendering a different message for any of those cases, in the UI, in a
// console message, or in any branch keyed off the underlying HTTP status. There is exactly one
// non-loading, non-success state: "denied". No token at all reaches the exact same state (the
// fetch is simply never issued).
//
// HEL-1190 design.md D1/D7 -- an output-kind panel renders its REAL row data (table/chart/etc.), reusing the SAME
// `PanelContent` renderers the authenticated experience uses, fed by `usePublicPanelData`.
//
// HEL-1587 -- the viewer now lays panels out from the dashboard's stored layout (`PublicPanelGrid`, read-only, at a
// container width >= 768px; below that the stacked list stays), renders text/markdown/image/divider content through the
// shared renderers, and shows a form panel as a disabled, non-submittable preview. See `PublicPanelBody`.

import { useEffect, useMemo, useState } from "react";
import { useContainerWidth } from "react-grid-layout";
import { useParams, useSearchParams } from "react-router-dom";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageSuspenseFallback } from "../../../shared/ui/SuspenseFallback";
import { fetchPublicDashboardPanels } from "../services/publicDashboardService";
import { orderPanelsForMobileStack, panelGridConfig } from "../../panels/ui/grid/panelGridConfig";
import type { Panel } from "../../panels/types/panel";
import type { DashboardLayout } from "../types/dashboard";
import { PublicPanelBody, PublicPanelTitleRow } from "./PublicPanelBody";
import { resolveDashboardLayout } from "../state/dashboardLayout";
import { PublicPanelGrid } from "./PublicPanelGrid";

import "./PublicDashboardViewerPage.css";
import { Link2 } from "lucide-react";

type ViewState = "loading" | "denied" | { panels: Panel[]; layout: DashboardLayout };

export function PublicDashboardViewerPage() {
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  // No token at all is denied identically to an invalid one -- never a distinct message, and
  // never a request is even issued (so there is no network-error branch to distinguish either).
  // Computed as the lazy initial state (not a synchronous setState inside the effect below) so
  // there is no cascading extra render for this case.
  const hasToken = dashboardId !== undefined && token !== null && token !== "";
  const [state, setState] = useState<ViewState>(hasToken ? "loading" : "denied");

  useEffect(() => {
    if (!hasToken || dashboardId === undefined || token === null) return;
    let cancelled = false;
    fetchPublicDashboardPanels(dashboardId, token)
      .then(({ panels, layout }) => {
        if (!cancelled) setState({ panels, layout });
      })
      .catch(() => {
        // Deliberately ignores the error's status/body -- expired, revoked, nonexistent, and
        // wrong-resource all collapse to the SAME rendered state here, matching the backend's own
        // single-exit denial (design.md D4).
        if (!cancelled) setState("denied");
      });
    return () => {
      cancelled = true;
    };
  }, [dashboardId, token, hasToken]);

  if (state === "loading") {
    return <PageSuspenseFallback />;
  }

  if (state === "denied") {
    return (
      <div className="public-dashboard-viewer public-dashboard-viewer--denied">
        <EmptyState
          icon={<Link2 />}
          title="This link isn't available"
          description="It may have been revoked, expired, or never existed. Ask the person who shared it for a new link."
        />
      </div>
    );
  }

  return (
    <PublicDashboardContent
      dashboardId={dashboardId as string}
      token={token as string}
      panels={state.panels}
      layout={state.layout}
    />
  );
}

/** The loaded viewer. A component of its own so `useContainerWidth` observes the wrapper from the wrapper's first mount
 *  (the hook attaches its observer once, in a mount effect). The measured width is a CONTAINER width, so a 1440px viewport
 *  (minus the viewer's side padding) resolves breakpoint md, not lg. */
function PublicDashboardContent({
  dashboardId,
  token,
  panels,
  layout,
}: {
  dashboardId: string;
  token: string;
  panels: Panel[];
  layout: DashboardLayout;
}) {
  // `measureBeforeMount`: the hook starts at a 1280px default and measures only after the first commit, so without it a
  // phone would first mount every panel body inside the grid (firing every rows/meta/form-schema read), then mount them
  // all again in the stack. Nothing renders in the wrapper until its real width is known.
  const { containerRef, width, mounted } = useContainerWidth({ measureBeforeMount: true });
  const showGrid = width >= panelGridConfig.breakpoints.sm;
  // The phone stack reads in the stored xs arrangement (y, then x), exactly as the signed-in `MobilePanelStack` orders it,
  // not in the API's newest-first order.
  const stackPanels = useMemo(
    () => orderPanelsForMobileStack(panels, resolveDashboardLayout(panels, layout).xs),
    [panels, layout],
  );
  return (
    <div
      ref={containerRef}
      className={`public-dashboard-viewer${showGrid ? " public-dashboard-viewer--grid" : ""}`}
    >
      {!mounted ? null : panels.length === 0 ? (
        <EmptyState
          icon={<Link2 />}
          title="Nothing to show yet"
          description="This dashboard doesn't have any panels."
        />
      ) : showGrid ? (
        <PublicPanelGrid
          dashboardId={dashboardId}
          token={token}
          panels={panels}
          layout={layout}
          width={width}
        />
      ) : (
        <ul className="public-dashboard-viewer__panel-list" aria-label="Dashboard panels">
          {stackPanels.map((panel) => (
            <li key={panel.id} className="public-dashboard-viewer__panel-row">
              <PublicPanelTitleRow
                panel={panel}
                dashboardId={dashboardId}
                token={token}
                headingLevel="span"
              />
              <PublicPanelBody panel={panel} dashboardId={dashboardId} token={token} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
