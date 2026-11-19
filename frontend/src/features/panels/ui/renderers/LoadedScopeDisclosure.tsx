// HEL-448 design D9a / HEL-451 design D4b, D4c, D10a — the SINGLE removal
// seam for both the sort qualifier ("Sort covers only the loaded rows.")
// and the filter-scoped disclosure this ticket adds. Both strings render
// through this ONE component so removing the disclosure entirely is one
// contiguous, grep-able change: delete this file and its call sites,
// nothing else. The disclosure itself is CONFIRMED by the owner (D10a);
// the removal seam stays because it is good structure independent of that
// confirmation, not because the disclosure is still provisional.
//
// Task 4.0f SUPERSESSION: when a filter is active AND the loaded set is
// truncated, the filter-scoped message SUPERSEDES the plain sort note — it
// is strictly more informative (names both the scope and the match count).
// Encoded here structurally (one `if`/`else` chain) rather than as two
// conditions at separate render sites that could drift apart.
interface LoadedScopeDisclosureProps {
  /** Branch-independent truncation signal (`usePanelData`'s `hasMore`) —
   *  see `TableRenderer`'s `rowsTruncated` prop doc comment. */
  rowsTruncated: boolean;
  /** Any active quick/per-column filter term. */
  filtering: boolean;
  /** Rows remaining after the filter predicate. Ignored when `!filtering`. */
  matchCount: number;
  /** Total rows currently loaded (pre-filter). Ignored when `!filtering`. */
  loadedCount: number;
  /** HEL-1780 D4(b)/(b2) -- set only in panel read scope while a client-side term (a sort or filter on a column the per-panel
   *  route may not be sent, or a quick search) is active. The server's total is then never a match count, so exactly one
   *  line renders: the scope note when rows remain unloaded; "{n} results." (n = `matchCount`, the client-filtered loaded
   *  rows) when every row is loaded and a filter is active; nothing for a sort alone over every row. */
  clientScope?: { sorted: boolean; filtered: boolean; loaded: number; total: number };
}

export function LoadedScopeDisclosure({
  rowsTruncated,
  filtering,
  matchCount,
  loadedCount,
  clientScope,
}: LoadedScopeDisclosureProps) {
  if (clientScope) {
    const { sorted, filtered, loaded, total } = clientScope;
    if (loaded < total) {
      const what = sorted && filtered ? "Sorted and filtered" : sorted ? "Sorted" : "Filtered";
      return (
        <p className="panel-content__loaded-scope-note">
          {what} within the {loaded} loaded rows of {total}.
        </p>
      );
    }
    if (!filtered) return null;
    return (
      <p className="panel-content__loaded-scope-note">
        {matchCount} {matchCount === 1 ? "result" : "results"}.
      </p>
    );
  }
  if (!filtering) {
    // HEL-1027 design.md D7 (task 5.1) — HEL-448's "Sort covers only the loaded rows." note is
    // REMOVED outright, not restated: once sort ranks the whole Output (this ticket),
    // `rowsTruncated` no longer implies a partial ranking, so this note would now be actively
    // wrong. Never reached by the HEL-588 cross-filter call site below (`OutputPanelContent.tsx`),
    // which always passes `filtering` literally `true`.
    return null;
  }

  if (!rowsTruncated) {
    // A complete answer — every row is loaded, so the count is never
    // qualified with a denominator (design D4, task 4.2).
    return (
      <p className="panel-content__loaded-scope-note">
        {matchCount} {matchCount === 1 ? "result" : "results"}.
      </p>
    );
  }

  return (
    <p className="panel-content__loaded-scope-note">
      {matchCount} of {loadedCount} loaded rows match.
    </p>
  );
}
