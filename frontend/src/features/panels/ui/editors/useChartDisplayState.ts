// HEL-248 — Chart per-chart-type display-option editor state for
// `BindingEditor`'s Chart panel edit pane.
//
// Extracted as a hook (mirroring `useTableDisplayState`) so `BindingEditor`
// stays within the file-size budget and the per-type option bookkeeping lives
// in one testable place. Presentational rendering is `ChartDisplayFields`.
//
// The working map holds every chart type's options at once; the edit pane only
// ever shows the *live* chart type's controls (`ChartDisplayFields`), so a
// type switch never touches another type's stored entry — that is the "switching
// type preserves all config" acceptance criterion, generalized.

import { useState } from "react";

import type {
  BarChartOptions,
  ChartTypeOptionsMap,
  LineChartOptions,
  Panel,
  PieChartOptions,
  ScatterChartOptions,
} from "../../types/panel";

export interface ChartDisplayState {
  line: LineChartOptions;
  setLine: (patch: Partial<LineChartOptions>) => void;
  bar: BarChartOptions;
  setBar: (patch: Partial<BarChartOptions>) => void;
  pie: PieChartOptions;
  setPie: (patch: Partial<PieChartOptions>) => void;
  scatter: ScatterChartOptions;
  setScatter: (patch: Partial<ScatterChartOptions>) => void;
  dirty: boolean;
  reset: () => void;
  /** The chartOptions slice of the Save PATCH: `undefined` when untouched (omit
   *  the key entirely → persist nothing), `null` to clear all stored options,
   *  or the normalized per-type map. */
  patch: ChartTypeOptionsMap | null | undefined;
}

/** Strip default-equivalent values so an untouched section normalizes to empty
 *  (and therefore persists nothing). A value that renders identically to the
 *  pre-change default (`false`, `"vertical"`, `"none"`, `0` donut hole, empty
 *  field) is dropped — this keeps the dirty check honest and the wire minimal. */
export function normalizeChartOptions(map: ChartTypeOptionsMap): ChartTypeOptionsMap {
  const line: LineChartOptions = {};
  if (map.line?.smooth) line.smooth = true;
  // ECharts renders point markers by default, so the meaningful stored value is
  // the "off" state — `false` is persisted, the default-`true` is dropped.
  if (map.line?.showPoints === false) line.showPoints = false;
  if (map.line?.areaFill) line.areaFill = true;

  const bar: BarChartOptions = {};
  if (map.bar?.orientation === "horizontal") bar.orientation = "horizontal";
  if (map.bar?.stacking && map.bar.stacking !== "none") bar.stacking = map.bar.stacking;
  if (map.bar?.barGapPct !== undefined) bar.barGapPct = map.bar.barGapPct;

  const pie: PieChartOptions = {};
  if (map.pie?.donutHolePct) pie.donutHolePct = map.pie.donutHolePct;
  if (map.pie?.showPercentLabels) pie.showPercentLabels = true;

  const scatter: ScatterChartOptions = {};
  if (map.scatter?.sizeField) scatter.sizeField = map.scatter.sizeField;
  if (map.scatter?.colorField) scatter.colorField = map.scatter.colorField;

  const normalized: ChartTypeOptionsMap = {};
  if (Object.keys(line).length > 0) normalized.line = line;
  if (Object.keys(bar).length > 0) normalized.bar = bar;
  if (Object.keys(pie).length > 0) normalized.pie = pie;
  if (Object.keys(scatter).length > 0) normalized.scatter = scatter;
  return normalized;
}

function storedMap(panel: Panel): ChartTypeOptionsMap {
  return panel.type === "chart" ? (panel.config.chartOptions ?? {}) : {};
}

export function useChartDisplayState(panel: Panel): ChartDisplayState {
  const stored = storedMap(panel);
  const storedNormalized = JSON.stringify(normalizeChartOptions(stored));

  const [resetNonce, setResetNonce] = useState(0);
  const [seedKey, setSeedKey] = useState(`${panel.id}|${resetNonce}`);
  const [working, setWorking] = useState<ChartTypeOptionsMap>(() => stored);

  // Re-seed the working map on a reset (nonce bump) or when a different panel is
  // edited — keyed on identity, not object reference, so an unrelated parent
  // re-render never clobbers an in-progress edit.
  const currentSeedKey = `${panel.id}|${resetNonce}`;
  if (seedKey !== currentSeedKey) {
    setSeedKey(currentSeedKey);
    setWorking(stored);
  }

  const line = working.line ?? {};
  const bar = working.bar ?? {};
  const pie = working.pie ?? {};
  const scatter = working.scatter ?? {};

  const setLine = (patch: Partial<LineChartOptions>) =>
    setWorking((prev) => ({ ...prev, line: { ...prev.line, ...patch } }));
  const setBar = (patch: Partial<BarChartOptions>) =>
    setWorking((prev) => ({ ...prev, bar: { ...prev.bar, ...patch } }));
  const setPie = (patch: Partial<PieChartOptions>) =>
    setWorking((prev) => ({ ...prev, pie: { ...prev.pie, ...patch } }));
  const setScatter = (patch: Partial<ScatterChartOptions>) =>
    setWorking((prev) => ({ ...prev, scatter: { ...prev.scatter, ...patch } }));

  const normalizedWorking = normalizeChartOptions(working);
  const dirty = JSON.stringify(normalizedWorking) !== storedNormalized;

  const patch: ChartTypeOptionsMap | null | undefined = !dirty
    ? undefined
    : Object.keys(normalizedWorking).length === 0
      ? null
      : normalizedWorking;

  const reset = () => setResetNonce((nonce) => nonce + 1);

  return {
    line,
    setLine,
    bar,
    setBar,
    pie,
    setPie,
    scatter,
    setScatter,
    dirty,
    reset,
    patch,
  };
}
