// HEL-1311 design D3 — pure, echarts-free histogram binning, importable from the main bundle (the
// skipped-values note) and from tests without pulling in the lazy chart chunk.

export interface HistogramBin {
  start: number;
  end: number;
  count: number;
}

export interface HistogramResult {
  bins: HistogramBin[];
  /** Cells that were blank or not a finite number. */
  skipped: number;
}

export const HISTOGRAM_AUTO_BIN_MAX = 50;

/** Sturges' rule `ceil(log2 n) + 1`, clamped to 1-50. */
export function automaticBinCount(n: number): number {
  if (n <= 0) return 0;
  return Math.min(HISTOGRAM_AUTO_BIN_MAX, Math.max(1, Math.ceil(Math.log2(n)) + 1));
}

/** Bins the numeric cells into equal-width bins over [min, max]; the last bin includes max. Numeric
 *  parsing is the chart paths' `parseFloat`. A single bin when min equals max (that wins over
 *  `binCount`); no bins when no cell is numeric. */
export function binHistogram(cells: readonly string[], binCount?: number): HistogramResult {
  const values: number[] = [];
  for (const cell of cells) {
    const n = parseFloat(cell);
    if (Number.isFinite(n)) values.push(n);
  }
  const skipped = cells.length - values.length;
  if (values.length === 0) return { bins: [], skipped };

  let min = values[0];
  let max = values[0];
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (min === max) return { bins: [{ start: min, end: max, count: values.length }], skipped };

  const count =
    binCount !== undefined && Number.isInteger(binCount) && binCount >= 1
      ? binCount
      : automaticBinCount(values.length);
  const width = (max - min) / count;
  const bins: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    start: min + i * width,
    end: i === count - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(count - 1, Math.floor((v - min) / width));
    bins[idx].count += 1;
  }
  return { bins, skipped };
}
