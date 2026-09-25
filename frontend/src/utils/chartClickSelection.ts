// HEL-572 — click→selection column mapping and row-filtering for
// chart-drilldown-inspect. Kept in this standalone module, deliberately
// free of any `echarts`/`echarts-for-react` runtime import, so that
// `PanelCard.tsx`/`PanelFullscreenOverlay.tsx` (eagerly bundled) can import
// it for row-filtering without pulling `ChartPanel.tsx`'s lazy-loaded
// echarts chunk into the main bundle — see `ChartRenderer.tsx`'s own
// HEL-512 comment for why that boundary is load-bearing. `ChartPanel.tsx`
// imports this same module for its click handler.

import type { ChartType } from "./chartAppearance";
import type { ScatterChartOptions } from "../features/panels/types/panel";

interface ResolvedColumns {
  xCol: number;
  yCol: number;
  seriesCol: number;
}

/** design.md D4 / tasks.md 2.1 — the SAME xCol/yCol/seriesCol index
 *  resolution `ChartPanel.tsx`'s `buildDataOption` performs, extracted so
 *  click mapping and row filtering can never resolve a different column
 *  than what was actually plotted. */
export function resolveDataColumns(
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
): ResolvedColumns {
  const xColName = fieldMapping?.xAxis;
  const yColName = fieldMapping?.yAxis;
  const seriesColName = fieldMapping?.series;
  return {
    xCol: xColName ? headers.indexOf(xColName) : 0,
    yCol: yColName ? headers.indexOf(yColName) : -1,
    seriesCol: seriesColName ? headers.indexOf(seriesColName) : -1,
  };
}

/** design.md D3's pie bullet — the same mapped-or-auto-detected
 *  value-column resolution `buildDataOption`'s pie branch performs (first
 *  numeric column, skipping `xCol`, when no `yAxis` mapping is set), shared
 *  so a click's resolved `series` name can never disagree with what the pie
 *  slice was actually built from. */
export function resolvePieValueColumn(
  rawRows: string[][],
  headers: string[],
  xCol: number,
  yCol: number,
): number {
  if (yCol !== -1) return yCol;
  for (let col = 0; col < headers.length; col++) {
    if (col === xCol) continue;
    const parsed = rawRows.map((r) => parseFloat(r[col] ?? ""));
    if (parsed.some((n) => !isNaN(n))) return col;
  }
  return -1;
}

/** design.md "SelectionDescriptor field semantics" — the panel-agnostic
 *  half of a selection: `dimension` is the source column name the
 *  selection is keyed on, `value` is the clicked category/label, `series`
 *  identifies the clicked measure/group. `panelId` is added by the caller
 *  (the component dispatching `selectDataPoint`) — the one field this
 *  chart-internal mapping has no way to know. */
export interface ChartClickSelection {
  dimension: string;
  value: string;
  series: string;
}

/** Minimal shape of ECharts' click-callback `params` this module actually
 *  reads. Kept narrow and free of any `echarts` runtime import (see this
 *  file's own header comment) rather than importing `echarts`'s
 *  `CallbackDataParams`/`ECElementEvent` types here — `ChartPanel.tsx`
 *  narrows the real event down to this shape before calling in. */
export interface ChartClickParams {
  componentType?: string;
  seriesName?: string;
  name?: string;
  value?: unknown;
}

/** design.md D3 — one click→column mapping per chart type, mirroring
 *  `buildDataOption`'s own branching. Returns `null` for a click whose
 *  resolved shape carries no mappable `name`/`value` (defensive — the
 *  `componentType === "series"` bail-out in `ChartPanel`'s handler is the
 *  primary gate, per design.md D2). */
export function mapChartClickToSelection(
  params: ChartClickParams,
  chartType: ChartType,
  fieldMapping: Record<string, string> | null | undefined,
  headers: string[],
  rawRows: string[][],
  scatterOptions?: ScatterChartOptions,
): ChartClickSelection | null {
  if (headers.length === 0) return null;
  const { xCol, yCol } = resolveDataColumns(headers, fieldMapping);
  if (xCol === -1) return null;
  const dimension = headers[xCol];

  if (chartType === "scatter") {
    if (!Array.isArray(params.value) || params.value.length === 0) return null;
    const colorColName = scatterOptions?.colorField;
    const grouped = !!colorColName && headers.indexOf(colorColName) !== -1;
    const series = grouped ? (params.seriesName ?? "") : yCol !== -1 ? headers[yCol] : "";
    return { dimension, value: String(params.value[0]), series };
  }

  if (chartType === "pie") {
    if (typeof params.name !== "string") return null;
    const valueCol = resolvePieValueColumn(rawRows, headers, xCol, yCol);
    return { dimension, value: params.name, series: valueCol !== -1 ? headers[valueCol] : "" };
  }

  // bar/line — every data shape `buildDataOption` produces (single series,
  // `fieldMapping.series`-grouped multi-series, or the auto-detected
  // multi-series shape used when no `yAxis` mapping is set) names its
  // ECharts series via `name`, so `params.seriesName` alone identifies the
  // clicked series across all three uniformly — including the
  // auto-detected shape design.md's D3 didn't separately enumerate. This is
  // safe there specifically because its `seriesCol` is always -1 (no
  // `fieldMapping.series`), so `filterRowsForSelection` below reduces to a
  // plain x-match — exactly correct, since every auto-detected series comes
  // from the SAME row at that x-category, not a row subset.
  if (typeof params.name !== "string") return null;
  return { dimension, value: params.name, series: params.seriesName ?? "" };
}

/** design.md D4 — row filtering for the inspect view, reusing the exact
 *  same resolved columns `mapChartClickToSelection` (and `buildDataOption`)
 *  use, so the two can never disagree about which rows a selection means. */
export function filterRowsForSelection(
  rawRows: string[][],
  headers: string[],
  fieldMapping: Record<string, string> | null | undefined,
  chartType: ChartType,
  selection: { value: string; series: string },
  scatterOptions?: ScatterChartOptions,
): string[][] {
  const { xCol, seriesCol } = resolveDataColumns(headers, fieldMapping);
  if (xCol === -1) return [];

  if (chartType === "scatter") {
    const colorColName = scatterOptions?.colorField;
    const colorCol = colorColName ? headers.indexOf(colorColName) : -1;
    // `selection.value` was stringified from a parsed float (design.md D3's
    // scatter bullet) — compare numerically rather than as raw strings, or
    // formatting differences (e.g. "3" vs "3.0") could mismatch.
    const target = parseFloat(selection.value);
    return rawRows.filter((row) => {
      if (parseFloat(row[xCol] ?? "") !== target) return false;
      return colorCol === -1 || (row[colorCol] ?? "") === selection.series;
    });
  }

  // bar/line/pie
  return rawRows.filter((row) => {
    if ((row[xCol] ?? "") !== selection.value) return false;
    return seriesCol === -1 || (row[seriesCol] ?? "") === selection.series;
  });
}

/** The chart-config half a panel's inspect view needs to filter/re-derive
 *  rows for a selection (see `PanelCard.tsx`) — `chartType` from the
 *  panel's own `appearance.chart` (`resolveChartType`, `chartAppearance.ts`),
 *  `fieldMapping`/`scatterOptions` from the bound Output's config
 *  (`readChartConfig`). Computed once at the `PanelCard`/
 *  `PanelFullscreenOverlay` level and threaded down, rather than
 *  re-fetched, so mounting the fullscreen overlay never doubles the
 *  `GET /api/outputs/:id` call this panel already makes. `null` when the
 *  panel's bound Output is not a `chart`-kind Output — the single gate both
 *  the ActionsMenu "Inspect" item and the `PanelInspectView` mount check
 *  against. */
export interface ChartInspectConfig {
  chartType: ChartType;
  fieldMapping: Record<string, string> | null;
  scatterOptions?: ScatterChartOptions;
}
