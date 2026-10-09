import { useCallback, useMemo, useState } from "react";

import { clearSelection, selectDataPoint } from "../state/panelsSlice";
import {
  readChartConfig,
  readTableConfig,
} from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { useAppDispatch } from "../../../hooks/reduxHooks";
import { useOutputMeta } from "./useOutputMeta";
import { useCrossFilterServerOps } from "./useCrossFilterServerOps";
import { useCrossFilteredPanelData } from "./useCrossFilteredPanelData";
import type { PanelDataResult } from "./usePanelData";
import type { Panel } from "../types/panel";
import { resolvePanelChartType } from "../ui/resolvePanelChartType";
import { chartAggregationSpec } from "../history/chartOverlay";
import type { ChartClickSelection, ChartInspectConfig } from "../../../utils/chartClickSelection";

/** The inspect + cross-filter-derivation wiring of the desktop `PanelCard` (extracted from it by
 *  HEL-1365): the Output's chart-inspect config, the cross-filtered rows/headers/records every
 *  `PanelInspectView` mount reads, and the grid-context inspect open/close/clear handlers. Must be
 *  called at the position in `PanelCard`'s hook sequence these lines occupied before extraction. */
export function usePanelCardInspect(
  panel: Panel,
  outputId: string | null,
  panelData: PanelDataResult,
) {
  const dispatch = useAppDispatch();
  // HEL-572 design.md D1/D5 — a SECOND, independent `useOutputMeta` fetch
  // (mirrors the existing precedent: `PanelContent`'s own `OutputPanelContent`
  // and `usePanelRunRefresh`, called from `PanelCardBody`, each already fetch
  // this same Output independently). Resolved HERE (not re-fetched again by
  // `PanelFullscreenOverlay`) specifically so mounting the fullscreen overlay
  // — which HEL-584 mounts unconditionally, gated only on eligibility, not on
  // `isFullscreenOpen` — never adds a THIRD/FOURTH redundant network call;
  // `chartInspectConfig` below is computed once and threaded down as a prop.
  const { output } = useOutputMeta(outputId);
  const chartInspectConfig: ChartInspectConfig | null = useMemo(() => {
    if (output?.kind !== "chart") return null;
    const cfg = readChartConfig(output.config);
    // HEL-1351 design D7 — the same resolver `ChartOutputPanel` renders with, so click mapping and
    // Inspect filtering agree with what is drawn; D3 — a scatter-resolved panel renders raw rows.
    const chartType = resolvePanelChartType(panel.appearance.chart, output.config);
    return {
      chartType,
      fieldMapping: cfg.fieldMapping,
      scatterOptions: cfg.chartOptions?.scatter,
      // Only while the chart actually plots the grouped aggregate (it needs the loaded records).
      aggregation:
        chartType === "scatter" || !panelData.paginationRows
          ? null
          : chartAggregationSpec(output.config),
      // HEL-1394 -- orders Inspect's columns; from the Output already held here (no extra fetch).
      columnOrderHint: {
        schema: output.schema.map((f) => f.name),
        columnOrder: readTableConfig(output.config).columnOrder,
      },
    };
  }, [output, panel.appearance.chart, panelData.paginationRows]);

  // HEL-588 design.md D4 / evaluation-1.md CR1 (cycle 2) / skeptic-final-1.md
  // CR1 (cycle 3) / evaluation-3.md CR1 (cycle 3) — the ALREADY
  // cross-filtered rawRows/headers, used by EVERY `PanelInspectView` mount
  // (both the grid-context one `PanelCard` mounts AND, via `inspectRawRows`/
  // `inspectHeaders`, the one nested inside `PanelFullscreenOverlay`):
  // Inspect renders its own `DataGrid` directly from these props rather than
  // going through `PanelContent`/`OutputPanelContent`, so it's the one
  // consumer that genuinely needs the filtered values threaded down to it
  // explicitly, in BOTH mount contexts. `PanelCardBody`/
  // `PanelFullscreenOverlay`'s own `<PanelContent>` calls receive the RAW
  // `panelData.rawRows`/`panelData.headers` instead (see their own call
  // sites in `PanelCard`) — `OutputPanelContent` filters those itself, using ITS OWN
  // already-resolved `output` (no new fetch, no race), and needs the RAW
  // input specifically so its `crossFilterLoadedRowCount` truncation-count
  // math reads the panel's TRUE total loaded rows, not an already-narrowed
  // count (skeptic-final-1.md CR1's fix). Reuses THIS hook's own
  // pre-existing `output` (never a second fetch) — exactly the same one
  // `chartInspectConfig` above already resolves.
  //
  // History (two related-but-distinct defects, same class, one call site
  // apart): skeptic-final-1.md CR1 fixed `PanelFullscreenOverlay` receiving
  // these cross-filtered values for its `<PanelContent>` prop (corrupting
  // the truncation count) by switching that ONE prop pair to raw. That fix's
  // own side effect — `PanelFullscreenOverlay` has only ONE `rawRows`/
  // `headers` prop pair internally, shared by its `<PanelContent>` AND its
  // nested `<PanelInspectView>` — meant the nested Inspect ALSO started
  // reading raw rows, silently ignoring the active cross-filter for a
  // sibling panel's own click-selection (evaluation-3.md's live repro: a
  // panel plotted by "region" but filterable by "quarter" correctly showed 1
  // row in the grid's Inspect and incorrectly showed all 4 in Fullscreen's).
  // Fixed by giving `PanelFullscreenOverlay` a SECOND, separate prop pair
  // (`inspectRawRows`/`inspectHeaders`) so its two internal consumers can
  // each get what they need without one shared value serving both.
  // HEL-1191 design.md D3/D9b — the SAME eligibility decision `PanelCardBody` computes (own call,
  // same inputs, same module-cached capabilities), used here for the Inspect rows (client filter
  // ONLY on the fallback: on the server path the shared paginationState is already narrowed) and
  // threaded to the fullscreen overlay, which never resolves an Output itself.
  const { mode: crossFilterMode } = useCrossFilterServerOps(panel, output);
  const {
    rawRows: crossFilteredRawRows,
    headers: crossFilteredHeaders,
    records: crossFilteredRecords,
  } = useCrossFilteredPanelData(
    panel,
    panelData.rawRows,
    panelData.headers,
    output,
    crossFilterMode,
    panelData.paginationRows,
  );

  const [isInspectOpen, setIsInspectOpen] = useState(false);
  const handleDataPointSelect = useCallback(
    (selection: ChartClickSelection) => {
      dispatch(selectDataPoint({ panelId: panel.id, ...selection }));
      setIsInspectOpen(true);
    },
    [dispatch, panel.id],
  );
  // spec.md "The selection descriptor is view state, cleared on panel/
  // dashboard switch" — Modal's own dismiss (Escape/backdrop/X) closes the
  // view WITHOUT clearing the selection; only the explicit clear/return
  // control (handleClearInspect) does both. See `PanelInspectView`'s own
  // `onClose`/`onClear` doc comments.
  const handleCloseInspect = useCallback(() => setIsInspectOpen(false), []);
  const handleClearInspect = useCallback(() => {
    setIsInspectOpen(false);
    dispatch(clearSelection(panel.id));
  }, [dispatch, panel.id]);
  const handleOpenInspectFromMenu = useCallback(() => setIsInspectOpen(true), []);

  return {
    chartInspectConfig,
    crossFilterMode,
    crossFilteredRawRows,
    crossFilteredHeaders,
    crossFilteredRecords,
    isInspectOpen,
    handleDataPointSelect,
    handleCloseInspect,
    handleClearInspect,
    handleOpenInspectFromMenu,
  };
}
