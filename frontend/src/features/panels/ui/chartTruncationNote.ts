/** HEL-1358 design D1/D2 — the on-chart "this chart is based on only the first N rows" note. */

function formatCount(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
}

/** D2 copy. "Based on" (not "Showing") stays true for an aggregated Output (bars group the loaded
 *  rows) and a client-fallback cross-filter (a subset of the loaded rows is plotted). `narrowed`
 *  means `total` is a server-filtered count, so it reads "matching rows". */
export function chartTruncationNoteText(loaded: number, total: number, narrowed: boolean): string {
  return `Based on the first ${formatCount(loaded)} of ${formatCount(total)} ${
    narrowed ? "matching rows" : "rows"
  }.`;
}

/** D1 — the note, or `null`. Fails closed: needs `rowsTruncated === true` AND a finite total
 *  greater than the PRE-cross-filter loaded count, so nothing renders before the first load. */
export function chartTruncationNote(args: {
  rowsTruncated: boolean | undefined;
  totalRowCount: number | undefined;
  loadedCount: number;
  narrowed: boolean;
}): string | null {
  const { rowsTruncated, totalRowCount, loadedCount, narrowed } = args;
  if (rowsTruncated !== true) return null;
  if (typeof totalRowCount !== "number" || !Number.isFinite(totalRowCount)) return null;
  if (!(loadedCount < totalRowCount)) return null;
  return chartTruncationNoteText(loadedCount, totalRowCount, narrowed);
}
