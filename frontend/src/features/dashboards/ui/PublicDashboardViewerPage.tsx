// HEL-590 CR1 -- the page a minted share link actually lands on: a public, unauthenticated
// read-only view of a dashboard's panels, reached via `?token=`. Deliberately minimal (a titled
// list of panels, not the full interactive `PanelGrid`) -- this is the floor that makes a share
// link land somewhere real, not the HEL-593 embed surface (no CSP/frame-ancestors/chrome-stripping
// work belongs here).
//
// THE DENIAL PATH IS THE MOST IMPORTANT PART OF THIS COMPONENT. The backend's
// `authorizeResourceWithSharing` already makes an expired, revoked, nonexistent, or
// wrong-resource token return a byte-identical 404 (AclDirective design D4) -- this component
// MUST NOT undo that by rendering a different message for any of those cases, in the UI, in a
// console message, or in any branch keyed off the underlying HTTP status. There is exactly one
// non-loading, non-success state: "denied". No token at all reaches the exact same state (the
// fetch is simply never issued).

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { faLink } from "@fortawesome/free-solid-svg-icons";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageSuspenseFallback } from "../../../shared/ui/SuspenseFallback";
import { fetchPublicDashboardPanels } from "../services/publicDashboardService";
import type { Panel } from "../../panels/types/panel";

import "./PublicDashboardViewerPage.css";

type ViewState = "loading" | "denied" | { panels: Panel[] };

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
      .then((panels) => {
        if (!cancelled) setState({ panels });
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
          icon={faLink}
          title="This link isn't available"
          description="It may have been revoked, expired, or never existed. Ask the person who shared it for a new link."
        />
      </div>
    );
  }

  return (
    <div className="public-dashboard-viewer">
      {state.panels.length === 0 ? (
        <EmptyState
          icon={faLink}
          title="Nothing to show yet"
          description="This dashboard doesn't have any panels."
        />
      ) : (
        <ul className="public-dashboard-viewer__panel-list" aria-label="Dashboard panels">
          {state.panels.map((panel) => (
            <li key={panel.id} className="public-dashboard-viewer__panel-row">
              <span className="public-dashboard-viewer__panel-title">{panel.title}</span>
              <span className="public-dashboard-viewer__panel-kind">{panel.type}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
