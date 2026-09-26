import { useCallback, useMemo } from "react";
import { MousePointerClick } from "lucide-react";

import "./PanelInspectView.css";
import { Modal } from "../../../shared/ui/Modal";
import { DataGrid } from "../../../shared/ui/DataGrid";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { ICON_SIZE } from "../../../shared/ui/iconSize";
import { useAppDispatch, useAppSelector } from "../../../hooks/reduxHooks";
import { setCrossFilter } from "../state/panelsSlice";
import { filterRowsForSelection } from "../../../utils/chartClickSelection";
import type { ChartInspectConfig } from "../../../utils/chartClickSelection";

export interface PanelInspectViewProps {
  panelId: string;
  /** Used only for the dialog's `aria-label` — the visible title stays a
   *  fixed "Inspect". */
  panelTitle: string;
  open: boolean;
  /** spec.md "The selection descriptor is view state, cleared on panel/
   *  dashboard switch" — Modal's OWN dismiss affordances (Escape, backdrop,
   *  the header × button) close the view WITHOUT clearing the selection; a
   *  same panel's inspect view closing this way must not lose it. Wired
   *  straight through to `Modal`'s own `onClose` (which never implies
   *  "clear data" for any other `Modal` consumer either — this component
   *  would be the one surprising exception if it did). */
  onClose: () => void;
  /** The explicit clear/return control's handler (design.md D5) — closes
   *  the view AND dispatches `clearSelection`. The one path that actually
   *  clears the selection from inside this component (panel removal and
   *  dashboard switch clear it elsewhere, via `panelsSlice`'s own
   *  extraReducers). */
  onClear: () => void;
  rawRows: string[][] | null;
  headers: string[] | null;
  /** Required (not optional) — the mount site (`PanelCard`/
   *  `PanelFullscreenOverlay`) only ever renders this component once its
   *  own `chartInspectConfig` is non-null (chart-eligible panels only). */
  chartInspectConfig: ChartInspectConfig;
  rowsTruncated?: boolean;
  /** `"preview"` inside the grid card, `"full"` inside the fullscreen
   *  overlay — matches the space available, per ticket §6/design.md D5. */
  variant: "full" | "preview";
}

/** HEL-572 design.md D5 — the click→selection→inspect view: lists exactly
 *  the currently-loaded rows matching the panel's current selection
 *  (`interactionState[panelId]`, read directly from Redux rather than
 *  threaded as a prop — see design.md D1: HEL-588 needs to read a panel's
 *  selection independent of whether ANY inspect view is open, so it stays
 *  the single owned source of truth rather than being duplicated into this
 *  component's own props). Wraps `Modal` directly — NOT `PanelDetailModal`,
 *  which owns a different action (customize) from the same trigger surface
 *  (design.md D5's own rationale). */
export function PanelInspectView({
  panelId,
  panelTitle,
  open,
  onClose,
  onClear,
  rawRows,
  headers,
  chartInspectConfig,
  rowsTruncated,
  variant,
}: PanelInspectViewProps) {
  const dispatch = useAppDispatch();
  const selection = useAppSelector((state) => state.panels.interactionState[panelId] ?? null);

  // HEL-588 design.md D3 / owner ruling "Action in Inspect" — the ONLY
  // writer of the dashboard's cross-filter. A chart click (`PanelCard.
  // handleDataPointSelect`) never reaches this; only this explicit footer
  // action does. Dispatches, then closes the SAME way the header ×/Escape/
  // backdrop already do (`onClose`, not `onClear` — the selection itself is
  // untouched, only the dashboard-level filter changes).
  const handleFilterDashboard = useCallback(() => {
    if (!selection) return;
    dispatch(setCrossFilter(selection));
    onClose();
  }, [dispatch, selection, onClose]);

  const filteredRows = useMemo(() => {
    if (!selection || !rawRows || !headers || headers.length === 0) return [];
    return filterRowsForSelection(
      rawRows,
      headers,
      chartInspectConfig.fieldMapping,
      chartInspectConfig.chartType,
      selection,
      chartInspectConfig.scatterOptions,
    );
  }, [selection, rawRows, headers, chartInspectConfig]);

  const gridRows = useMemo(() => {
    if (!headers) return [];
    return filteredRows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
  }, [filteredRows, headers]);

  const headerLabel = selection
    ? `Showing rows for ${selection.dimension}: ${selection.value}${
        selection.series ? ` / ${selection.series}` : ""
      }`
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size={variant === "full" ? "lg" : "md"}
      title="Inspect"
      description={headerLabel ? <span>{headerLabel}</span> : undefined}
      ariaLabel={`Inspect ${panelTitle}`}
      footer={
        <>
          {/* HEL-588 design.md D3/tasks.md 2.1 — owner ruling "Action in
              Inspect": the ONLY gesture that sets the dashboard's
              cross-filter. Rendered only alongside a real selection — there
              is nothing to filter by from the empty state. An ordinary
              `<button>`, natively focusable/Tab-reachable (tasks.md 2.4) —
              no bespoke keyboard plumbing needed. */}
          {selection && (
            <button
              type="button"
              className="ui-modal-btn ui-modal-btn--primary"
              onClick={handleFilterDashboard}
            >
              Filter dashboard by {selection.dimension} ={" "}
              <span className="mono">{selection.value}</span>
            </button>
          )}
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            onClick={selection ? onClear : onClose}
          >
            {selection ? "Clear selection" : "Close"}
          </button>
        </>
      }
    >
      {selection ? (
        <div className="panel-inspect-view__body">
          {/* spec.md "Inspect view discloses truncation" — honest copy: only
              the currently-loaded rows are shown, not necessarily every row
              matching the selection upstream. */}
          {rowsTruncated && (
            <p className="panel-inspect-view__truncation-notice" role="status">
              Showing only the currently loaded rows — more rows for this selection may exist
              upstream.
            </p>
          )}
          <DataGrid
            rows={gridRows}
            variant={variant}
            emptyText="No loaded rows match this selection."
          />
        </div>
      ) : (
        <EmptyState
          icon={<MousePointerClick aria-hidden="true" size={ICON_SIZE.lg} />}
          variant="sidebar"
          title="Nothing selected"
          description="Click a chart element to inspect its underlying rows."
        />
      )}
    </Modal>
  );
}
