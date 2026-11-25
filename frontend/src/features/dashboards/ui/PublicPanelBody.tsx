// HEL-1190 / HEL-1587 -- the per-panel BODY of the public share viewer, shared by the stacked list (phones) and the
// read-only grid (>= 768px). An output panel keeps its data-fed `PanelContent`; a form panel is a read-only preview;
// text/markdown/image/divider render through the app's own `PanelContent` path (the same renderers, `markdownUrls`
// and `sanitizeImageUrl` as the signed-in app, never a copy).

import { useCallback, useMemo } from "react";

import { fetchPublicDistinctValues } from "../services/publicDashboardService";
import { isFormPanel, isOutputPanel } from "../../panels/state/panelNarrowing";
import { OutputViewerControlBar } from "../../panels/ui/OutputViewerControlBar";
import { PanelContent } from "../../panels/ui/PanelContent";
import { ProvenanceTrigger } from "../../panels/provenance/ProvenanceTrigger";
import { usePublicPanelData } from "../../panels/hooks/usePublicPanelData";
import { useViewerControls } from "../../panels/hooks/useViewerControls";
import { buildViewerControlFilterOps } from "../../panels/state/viewerControlValues";
import type { OutputPanel, Panel } from "../../panels/types/panel";
import { PublicFormPreview } from "./PublicFormPreview";

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
        columns={panelData.columns}
        totalRowCount={panelData.total}
        rowsTruncated={panelData.rowsTruncated}
        filteredMetric={panelData.filteredMetric}
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

/** The body for any panel kind on the public viewer. */
export function PublicPanelBody({
  panel,
  dashboardId,
  token,
}: {
  panel: Panel;
  dashboardId: string;
  token: string;
}) {
  if (isOutputPanel(panel)) {
    return <PublicOutputPanelBody panel={panel} dashboardId={dashboardId} token={token} />;
  }
  // A form panel is branched off BEFORE `PanelContent`: `PanelContent` routes `form` to the signed-in `FormRenderer`, which
  // owns the submit path and the authenticated form-schema route. The public page shows a disabled preview instead, so a
  // form never reaches `PanelContent` here.
  if (isFormPanel(panel)) {
    return (
      <PublicFormPreview
        dashboardId={dashboardId}
        panelId={panel.id}
        token={token}
        config={panel.config}
      />
    );
  }
  return <PanelContent panel={panel} appearance={panel.appearance} crossFilterMode="none" />;
}

/** A public card's title row: the title (the heading) with, for an output panel, its provenance trigger at the trailing end,
 *  beside the title and never inside it (mirrors the signed-in phone header). HEL-1207 A1 put the trigger on a row of its
 *  own because no card existed; the card now exists, so it takes the title row's empty right side. The public variant
 *  reads the token-authorized public endpoint and renders no link or ids. */
export function PublicPanelTitleRow({
  panel,
  dashboardId,
  token,
  headingLevel,
}: {
  panel: Panel;
  dashboardId: string;
  token: string;
  /** `h2` in the grid card; the stack item keeps its existing span. */
  headingLevel: "h2" | "span";
}) {
  const title =
    headingLevel === "h2" ? (
      <h2 className="panel-grid-card__title">{panel.title}</h2>
    ) : (
      <span className="public-dashboard-viewer__panel-title">{panel.title}</span>
    );
  return (
    <div className="public-dashboard-viewer__title-row">
      {title}
      {isOutputPanel(panel) && (
        <ProvenanceTrigger
          panelId={panel.id}
          panelTitle={panel.title}
          outputId={panel.config.outputId}
          variant="public"
          dashboardId={dashboardId}
          token={token}
        />
      )}
    </div>
  );
}
