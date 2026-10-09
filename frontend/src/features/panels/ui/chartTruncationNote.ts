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

/** HEL-1398 -- the narrow-card short form ("200 of 1,234 rows."), shown only under the `panel-card`
 *  narrow container query; the full sentence stays in the DOM (visually hidden) for assistive tech. */
export function chartTruncationNoteShortText(
  loaded: number,
  total: number,
  narrowed: boolean,
): string {
  return `${formatCount(loaded)} of ${formatCount(total)} ${narrowed ? "matching rows" : "rows"}.`;
}

interface TruncationArgs {
  rowsTruncated: boolean | undefined;
  totalRowCount: number | undefined;
  loadedCount: number;
  narrowed: boolean;
}

/** The one fail-closed gate both forms share: needs `rowsTruncated === true` AND a finite total
 *  greater than the PRE-cross-filter loaded count, so nothing renders before the first load. */
function truncationCounts(args: TruncationArgs): { loaded: number; total: number } | null {
  const { rowsTruncated, totalRowCount, loadedCount } = args;
  if (rowsTruncated !== true) return null;
  if (typeof totalRowCount !== "number" || !Number.isFinite(totalRowCount)) return null;
  if (!(loadedCount < totalRowCount)) return null;
  return { loaded: loadedCount, total: totalRowCount };
}

/** D1 -- the note, or `null`. */
export function chartTruncationNote(args: TruncationArgs): string | null {
  const counts = truncationCounts(args);
  return counts ? chartTruncationNoteText(counts.loaded, counts.total, args.narrowed) : null;
}

/** HEL-1398 -- the short form of the same note; `null` exactly when `chartTruncationNote` is. */
export function chartTruncationNoteShort(args: TruncationArgs): string | null {
  const counts = truncationCounts(args);
  return counts ? chartTruncationNoteShortText(counts.loaded, counts.total, args.narrowed) : null;
}
