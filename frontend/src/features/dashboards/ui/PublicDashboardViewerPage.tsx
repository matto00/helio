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
// HEL-1190 design.md D1/D7 (owner-ruling fold-in) -- an output-kind panel now renders its REAL
// row data (table/chart/etc.), reusing the SAME `PanelContent`/`TableRenderer`/chart renderers the
// authenticated experience uses (C13), fed by `usePublicPanelData` instead of the authenticated,
// session-cookie-based `usePanelData`/`fetchPanelPage`. Every OTHER panel kind (text/markdown/
// image/divider/form) keeps the pre-existing title+kind row -- the spec's own scope is "each
// OUTPUT-kind panel" (`public-dashboard-panel-content` Requirement 1); expanding a form panel's
// submit affordance onto this anonymous/read-only surface is explicitly what the sibling
// "read-only" requirement forbids, so it is never given real (interactive) content here.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { EmptyState } from "../../../shared/ui/EmptyState";
import { PageSuspenseFallback } from "../../../shared/ui/SuspenseFallback";
import {
  fetchPublicDashboardPanels,
  fetchPublicDistinctValues,
} from "../services/publicDashboardService";
import { isOutputPanel } from "../../panels/state/panelNarrowing";
import { OutputViewerControlBar } from "../../panels/ui/OutputViewerControlBar";
import { PanelContent } from "../../panels/ui/PanelContent";
import { ProvenanceTrigger } from "../../panels/provenance/ProvenanceTrigger";
import { usePublicPanelData } from "../../panels/hooks/usePublicPanelData";
import { useViewerControls } from "../../panels/hooks/useViewerControls";
import { buildViewerControlFilterOps } from "../../panels/state/viewerControlValues";
import type { OutputPanel, Panel } from "../../panels/types/panel";

import "./PublicDashboardViewerPage.css";
import { Link2 } from "lucide-react";

type ViewState = "loading" | "denied" | { panels: Panel[] };

/** HEL-1190 design.md D1-D4/D10 (tasks 3.2, 4.1-4.5, 5.4/5.5) — the per-panel body for an
 *  output-kind panel on the public viewer, mirroring `MobileStackPanelBody`'s "one hook-holding
 *  component per list item" shape (a map body can't call a hook directly). `PanelContent` is
 *  rendered completely unmodified — same component the authenticated grid/stack/modal/overlay all
 *  render through (D1/C13). Viewer controls are URL-held (`useViewerControls`, keyed by
 *  `panel.id` — the SAME key an authenticated render path of the same dashboard would use, so a
 *  URL copied from one context reproduces identically in the other) and composed into the public
 *  rows request via `usePublicPanelData`'s own `filter` param; dropdown options come from the
 *  panel-scoped PUBLIC distinct-values route (D5), never the authenticated one. */
function PublicOutputPanelBody({
  panel,
  dashboardId,
  token,
}: {
  panel: OutputPanel;
  dashboardId: string;
  token: string;
}) {
  const controls = panel.config.controls;
  const {
    values: controlValues,
    setValue: setControlValue,
    clearValue: clearControlValue,
  } = useViewerControls(panel.id, controls);
  const controlFilterOps = useMemo(
    () => buildViewerControlFilterOps(controls, controlValues),
    [controls, controlValues],
  );
  const hasVisibleControls = useMemo(() => controls.some((c) => !c.orphaned), [controls]);
  const fetchDistinctValues = useCallback(
    (column: string) =>
      fetchPublicDistinctValues(dashboardId, panel.id, token, column).then((r) => r.values),
    [dashboardId, panel.id, token],
  );

  const historySource = useMemo(
    () => ({ variant: "public" as const, dashboardId, token }),
    [dashboardId, token],
  );
  const panelData = usePublicPanelData(
    panel,
    dashboardId,
    token,
    undefined,
    controlFilterOps.length > 0 ? { ops: controlFilterOps } : undefined,
  );

  return (
    <>
      {/* HEL-1207 A1: no card/footer exists here, so provenance gets its own small row. The
          public variant reads the token-authorized public endpoint and renders no link or ids. */}
      <div className="public-dashboard-viewer__provenance-row">
        <ProvenanceTrigger
          panelId={panel.id}
          panelTitle={panel.title}
          outputId={panel.config.outputId}
          variant="public"
          dashboardId={dashboardId}
          token={token}
        />
      </div>
      {hasVisibleControls && (
        <OutputViewerControlBar
          controls={controls}
          values={controlValues}
          onChange={setControlValue}
          onClear={clearControlValue}
          fetchDistinctValues={fetchDistinctValues}
        />
      )}
      <PanelContent
        panel={panel}
        appearance={panel.appearance}
        rawRows={panelData.rawRows}
        headers={panelData.headers}
        isLoading={panelData.isLoading}
        error={panelData.error}
        noData={panelData.noData}
        paginationRows={panelData.paginationRows}
        totalRowCount={panelData.total}
        // HEL-1190 design.md D9 — `panelData.output` is ALWAYS a `PublicOutputMeta`
        // (`ownerId: null`, structurally, never a real owner id), which is what keeps
        // `TableRenderer`'s `canWrite` false here regardless of the viewing session's identity.
        output={panelData.output}
        outputMetaLoading={panelData.outputMetaLoading}
        // HEL-1191 design.md D6 — no cross-filter can be set on a public dashboard (no
        // `PanelCard`/`PanelInspectView`/`CrossFilterIndicator` here), so the client-side
        // cross-filter path must never engage.
        crossFilterMode="none"
        viewerFilterActive={controlFilterOps.length > 0}
        historySource={historySource}
      />
      {/* HEL-1190 design.md D10 (task 5.5) — this page had NO live region at all before this
          ticket; a control-driven row-count change is announced here. */}
      {hasVisibleControls && (
        <div className="sr-only" role="status">
          {`${panelData.total} result${panelData.total === 1 ? "" : "s"}.`}
        </div>
      )}
    </>
  );
}

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
          icon={<Link2 />}
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
          icon={<Link2 />}
          title="Nothing to show yet"
          description="This dashboard doesn't have any panels."
        />
      ) : (
        <ul className="public-dashboard-viewer__panel-list" aria-label="Dashboard panels">
          {state.panels.map((panel) => (
            <li key={panel.id} className="public-dashboard-viewer__panel-row">
              {isOutputPanel(panel) ? (
                <>
                  <span className="public-dashboard-viewer__panel-title">{panel.title}</span>
                  <PublicOutputPanelBody
                    panel={panel}
                    dashboardId={dashboardId as string}
                    token={token as string}
                  />
                </>
              ) : (
                <>
                  <span className="public-dashboard-viewer__panel-title">{panel.title}</span>
                  <span className="public-dashboard-viewer__panel-kind">{panel.type}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
