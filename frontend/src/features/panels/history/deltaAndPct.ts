// HEL-1705 D4: the client port of the server's `OutputHistoryService.deltaAndPct`, so the live Output column's metric
// comparison measures the draft rows' value against the history baseline with the server's own arithmetic. Both sides assert
// `shared-test-fixtures/delta-and-pct.json`.

const finite = (n: number): number | null => (Number.isFinite(n) ? n : null);

/** `delta = cur - base`; `pct = delta / |base| * 100`, `null` when `base` is 0; any non-finite result, or a `null` side, is
 *  `null`. */
export function deltaAndPct(
  current: number | null,
  baseline: number | null,
): { delta: number | null; pct: number | null } {
  if (current === null || baseline === null) return { delta: null, pct: null };
  return {
    delta: finite(current - baseline),
    pct: baseline === 0 ? null : finite(((current - baseline) / Math.abs(baseline)) * 100),
  };
}
