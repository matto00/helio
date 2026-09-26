import { useCallback, useState } from "react";

import "./PanelFullscreenOverlay.css";
import { Modal } from "../../../shared/ui/Modal";
import { PanelContent } from "./PanelContent";
import { PanelInspectView } from "./PanelInspectView";
import { clearSelection, selectDataPoint } from "../state/panelsSlice";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import type { PanelDataResult } from "../hooks/usePanelData";
import type { Panel } from "../types/panel";
import type { ChartClickSelection, ChartInspectConfig } from "../../../utils/chartClickSelection";

export interface PanelFullscreenOverlayProps extends Omit<PanelDataResult, "isRefreshing"> {
  panel: Panel;
  open: boolean;
  onClose: () => void;
  /** HEL-572 design.md D5 — computed once by the caller (`PanelCard`, from
   *  its own `useOutputMeta` call) and threaded down here, rather than
   *  re-fetched — this overlay is mounted UNCONDITIONALLY (gated only on
   *  `isFullscreenEligible`, not on `open`), so a second independent
   *  `GET /api/outputs/:id` here would fire on every dashboard render, not
   *  only while fullscreen is actually open. `null` for a non-chart-eligible
   *  panel — this overlay mounts no inspect view then. */
  chartInspectConfig: ChartInspectConfig | null;
  /** evaluation-3.md CR1 — the nested `PanelInspectView`'s OWN rawRows/
   *  headers, DELIBERATELY SEPARATE from `rawRows`/`headers` above (which
   *  feed this component's own `<PanelContent>` and must stay RAW for D7
   *  truncation-count correctness — see `skeptic-final-1.md`'s fix). Inspect
   *  renders its own `DataGrid` directly from these props rather than going
   *  through `PanelContent`/`OutputPanelContent`, so it needs the ALREADY
   *  cross-filtered values `PanelCard` already computes for the grid-context
   *  `PanelInspectView` (`crossFilteredRawRows`/`crossFilteredHeaders`) —
   *  without this SECOND prop pair, Fullscreen's chart correctly narrows by
   *  the active cross-filter while its own nested Inspect (for an identical
   *  click) silently shows every row regardless of dimension, contradicting
   *  HEL-572's preserved "Inspect shows exactly the plotted rows for its
   *  selection" invariant (probe-confirmed live: a dimension-mismatch panel
   *  — plotted by "region", filterable by "quarter" — showed the grid's
   *  Inspect correctly narrowing to 1 row while Fullscreen's nested Inspect
   *  for the identical click showed all 4). Falls back to `rawRows`/
   *  `headers` when omitted (defensive only — `PanelCard` always passes
   *  this explicitly). */
  inspectRawRows?: string[][] | null;
  inspectHeaders?: string[] | null;
}

/**
 * HEL-584 — a maximized, view-only rendering of a single panel's content,
 * opened from `PanelCard`'s header Fullscreen control.
 *
 * Mounted unconditionally by `PanelCard` (matching `QuickLauncherOverlay`'s
 * always-mounted-with-a-toggled-`open`-prop precedent, not
 * `PanelDetailModal`'s conditionally-mounted one — that component has no
 * `panel` to render at all when nothing is selected, which doesn't apply
 * here). `Modal` always renders its header (title/description) regardless
 * of the native `open` attribute, but this component gates its OWN body
 * (`PanelContent` — the expensive part: a chart panel instantiates a real
 * ECharts instance) on `open` so a closed overlay never pays for a second,
 * hidden render of a panel's content, and so Modal's own `[open]` effect
 * (showModal()/close() + focus-capture/restore) sees a real, toggling
 * `open` prop instead of a component that only ever mounts already-open —
 * unmounting instead of toggling would skip that effect's close-time
 * "else" branch (where the focus restore lives) entirely.
 *
 * design.md Decision 1: wraps the shared `Modal` primitive (`size="full"`)
 * rather than forking a bespoke full-viewport overlay — reuses Modal's
 * opaque surface, backdrop, single entrance animation, native focus trap,
 * `Esc`-close, and focus restore unmodified. `className="panel-fullscreen-
 * overlay"` (Decision 1a) gives the dialog a definite height, since Modal's
 * own `size="full"` preset is width-only and would otherwise shrink-to-fit
 * its content — see that CSS file's own comment.
 *
 * design.md Decision 2: receives the SAME `PanelDataResult` fields
 * `PanelCardBody` takes, as props from the caller's existing
 * `usePanelData` result — never calls that hook itself, so opening
 * fullscreen can never race HEL-579's in-flight refresh guard with a second,
 * independent fetch instance for the same panel.
 *
 * Renders `PanelContent` unmodified (no forked chart/table/markdown
 * rendering) — the fullscreen render always matches the card.
 */
export function PanelFullscreenOverlay({
  panel,
  open,
  onClose,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  errorKind,
  noData,
  neverMaterialized,
  chartAggregate,
  rowsTruncated,
  refresh,
  chartInspectConfig,
  inspectRawRows,
  inspectHeaders,
}: PanelFullscreenOverlayProps) {
  const dispatch = useAppDispatch();

  // HEL-572 design.md D5 — this overlay's OWN "is the inspect view open"
  // local boolean, parallel to `PanelCard`'s grid-context one; the
  // SELECTION itself stays the single Redux-owned source of truth both
  // mount points read (`PanelInspectView`).
  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const handleDataPointSelect = useCallback(
    (selection: ChartClickSelection) => {
      dispatch(selectDataPoint({ panelId: panel.id, ...selection }));
      setIsInspectOpen(true);
    },
    [dispatch, panel.id],
  );
  // spec.md — Modal's own dismiss (Escape/backdrop/X) closes the view
  // without clearing the selection; only the explicit clear/return control
  // does both. See `PanelInspectView`'s own `onClose`/`onClear` doc
  // comments, and `PanelCard`'s identical split for the grid-context view.
  const handleCloseInspect = useCallback(() => setIsInspectOpen(false), []);
  const handleClearInspect = useCallback(() => {
    setIsInspectOpen(false);
    dispatch(clearSelection(panel.id));
  }, [dispatch, panel.id]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      className="panel-fullscreen-overlay"
      title={panel.title}
      description={<span className="eyebrow">{panel.type}</span>}
      ariaLabel={`${panel.title} fullscreen`}
    >
      {/* Gated on `open` — see this component's own doc comment for why:
          Modal renders `children` into the DOM regardless of its native
          `open` attribute, so an ungated `PanelContent` here would
          instantiate a second, hidden chart-panel/ECharts instance per
          dashboard panel at all times, not only while the overlay is
          actually open. */}
      {open && (
        <div className="panel-fullscreen-overlay__body">
          <PanelContent
            panel={panel}
            data={data}
            rawRows={rawRows}
            headers={headers}
            isLoading={isLoading}
            error={error}
            errorKind={errorKind}
            onRetry={refresh}
            retryVariant="button"
            noData={noData}
            neverMaterialized={neverMaterialized}
            chartAggregate={chartAggregate}
            rowsTruncated={rowsTruncated}
            onDataPointSelect={handleDataPointSelect}
          />
          {/* HEL-572 design.md D5 — nested inside the already-open
              Fullscreen dialog; both are native `<dialog>`s (Modal), so
              Escape while Inspect is open closes only the topmost (Inspect)
              for free from the browser — no bespoke stacking logic needed
              (design.md Context). Gated on the SAME `open` as the body
              above: Inspect can only ever be reached via a click inside it,
              so it never needs to exist while Fullscreen itself is closed.
              `DataGrid variant="full"`, matching the space available here
              (ticket §6). */}
          {chartInspectConfig && (
            <PanelInspectView
              panelId={panel.id}
              panelTitle={panel.title}
              open={isInspectOpen}
              onClose={handleCloseInspect}
              onClear={handleClearInspect}
              rawRows={inspectRawRows !== undefined ? inspectRawRows : (rawRows ?? null)}
              headers={inspectHeaders !== undefined ? inspectHeaders : (headers ?? null)}
              chartInspectConfig={chartInspectConfig}
              rowsTruncated={rowsTruncated}
              variant="full"
            />
          )}
        </div>
      )}
    </Modal>
  );
}
