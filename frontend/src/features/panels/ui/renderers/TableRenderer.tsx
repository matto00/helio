import { useMemo, useState } from "react";

import "./TableRenderer.css";
import { DataGrid, Spinner } from "../../../../shared/ui/index";
import type { ColumnDef } from "../../../../shared/ui/index";
import { useAppSelector } from "../../../../hooks/reduxHooks";
import { LoadedScopeDisclosure } from "./LoadedScopeDisclosure";
import { withCellRules, withRowRules } from "./tableConditionalFormats";
import { UNSORTED_SENTINEL } from "./tableRendererModel";
import type { TableRendererProps } from "./tableRendererProps";
import { useTablePersistedState } from "./useTablePersistedState";
import { useTableRows } from "./useTableRows";

export function TableRenderer({
  outputId,
  ownerId,
  rawRows,
  headers,
  paginationRows,
  paginationIsLoadingMore,
  onLoadMore,
  rowsTruncated = false,
  columnOrder,
  columnSort,
  columnFilters,
  columnFormats,
  pinnedColumns,
  formatIntl,
  schema,
  onSortChange,
  onFilterChange,
  totalRowCount,
  leadingColumns,
  rowClassName,
  conditionalFormats,
  disablePinning = false,
}: TableRendererProps) {
  // Local-only column widths (no longer persisted — see the file's HEL-909
  // interface-parity note, now folded into the `outputId` doc comment).
  const [widths, setWidths] = useState<Record<string, number>>({});

  const handleColumnResize = (key: string, width: number) => {
    setWidths((prev) => ({ ...prev, [key]: width }));
  };

  // HEL-448 design D7: pre-check, never attempt-then-swallow-403. A
  // grantee's sort stays session-local, silently — no toast, no disabled
  // control.
  const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
  const canWrite = ownerId != null && currentUserId != null && ownerId === currentUserId;

  const {
    usingPagination,
    usingRaw,
    columns,
    formattedColumns,
    normalizedRows,
    filters,
    setFilters,
    filtering,
    filteredRows,
    sortState,
    toggleSort,
    displayRows,
  } = useTableRows({
    paginationRows,
    rawRows,
    headers,
    schema,
    columnOrder,
    columnFormats,
    formatIntl,
    columnFilters,
    columnSort,
    onSortChange,
  });

  const { pinnedKeys, handleSort, handleFilterChange, handleClearFilters, handlePinToggle } =
    useTablePersistedState({
      outputId,
      columnOrder,
      pinnedColumns,
      onSortChange,
      onFilterChange,
      canWrite,
      columns,
      setFilters,
      sortState,
      toggleSort,
    });

  // HEL-451 design D4/4.1 — the five-state disclosure matrix, computed from
  // `rowsTruncated` (task 4.0's branch-independent signal) and `filtering`.
  // The two EMPTY states are handled entirely by `DataGrid`'s D5 empty-state
  // slot below (`emptyText`/`emptyAction`, passed once here); `LoadedScope
  // Disclosure` covers the three non-empty states. This division is a
  // CONTRACT `TableRenderer` relies on: `DataGrid` renders the zero-match
  // explanation UNCONDITIONALLY whenever `isEmpty` is true, regardless of
  // its OWN internal filter-chrome expand/collapse state (D10-11) — that
  // internal detail changes ONLY the explanation's presentation (full text
  // vs. a line-clamped compact form), never whether it renders at all. An
  // earlier revision broke this by also gating the message on `DataGrid`'s
  // collapse state, silently reintroducing "a filter matching nothing
  // renders as a confident wrong answer" exactly when a short panel
  // auto-collapsed. If `DataGrid` ever needs `TableRenderer` to branch on
  // its expand state for this, that is a contract change to state HERE,
  // not a silent assumption to lose track of again.
  const isEmpty = displayRows.length === 0;

  // HEL-451 skeptic CR5 — 4.0g NAMED BOOLEANS, corrected. Task 4.0g's
  // original formula (`showSortNote = rowsTruncated && !filtering`) predates
  // this ticket's OWN filter-scoped message and is WRONG once it exists:
  // design D4b's filter-disclosure table requires the scoped "N of M loaded
  // rows match." note to render whenever `filtering && rowsTruncated`, WITH
  // OR WITHOUT `onLoadMore` (the panel detail modal never has one) — the
  // literal old formula would silently drop that note in the modal, which
  // is the exact confidently-wrong-answer state this design exists to
  // prevent. `showLoadedScopeNote` generalizes "show a note" to every
  // `rowsTruncated` state (`LoadedScopeDisclosure` picks the WORDING from
  // `filtering` internally, per the 4.0f supersession) rather than only the
  // un-filtered one. Amended in design.md D4b/tasks.md 4.0g in the same
  // commit as this fix.
  // HEL-1027 design.md D7 (task 5.1) — tightened from `rowsTruncated || filtering`:
  // `LoadedScopeDisclosure`'s `!filtering` branch always returns `null` now (the removed HEL-448
  // sort note), so a sort-only truncation (no filter active) has nothing left to show here —
  // showing it would render an empty wrapper `<div>` below for no reason.
  const showLoadedScopeNote = filtering;
  const showLoadMoreBtn = rowsTruncated && onLoadMore != null;
  // The wrapper is STILL derived from its children, per 4.0g's own
  // discipline — not simplified to `rowsTruncated` alone, even though that
  // is what it evaluates to today, because `showLoadedScopeNote` and
  // `showLoadMoreBtn` are independently the two things that can make this
  // wrapper non-empty and a future third child should extend this OR, not
  // replace it.
  const showTruncationWrapper = !isEmpty && (showLoadedScopeNote || showLoadMoreBtn);

  // HEL-1027 design.md D10 (task 4.8) — collapses all three prior `filtering && isEmpty` cases
  // (truncated-with-load-more, truncated-without-load-more, not-truncated) to the SAME simple
  // message. The "rows loaded so far... load more to widen the search" wording is now FALSE:
  // filtering is server-side, so `rowsTruncated`/`hasMore` already derive from the FILTERED total
  // (D5) — a filtered total of `0` makes `hasMore` false for any non-negative offset/limit, so
  // this branch is reachable only as a brief, transient artifact of a filter/sort change whose
  // refetch hasn't landed yet, never a real "more of the Output might still match" state.
  // `showLoadMoreBtn`'s existing gating is unchanged — it already correctly hides the "Load more"
  // button in the true zero-total steady state; only this TEXT changes.
  const emptyText = !filtering ? undefined : "No rows match your filter.";

  const emptyAction = !filtering ? undefined : (
    <div className="panel-content__filter-empty-actions">
      <button
        type="button"
        className="panel-content__clear-filters-btn"
        onClick={handleClearFilters}
      >
        Clear filters
      </button>
      {/* HEL-451 design D4: the detail modal has no `onLoadMore` at all, so
          the sharpest (truncated-empty) state cannot offer this action
          there — text-without-action, never an undefined-prop button
          (task 4.0a). */}
      {showLoadMoreBtn && (
        <button
          className="panel-content__load-more-btn"
          onClick={onLoadMore}
          disabled={paginationIsLoadingMore}
          aria-busy={paginationIsLoadingMore}
        >
          {paginationIsLoadingMore ? (
            <>
              <Spinner size="sm" />
              Loading...
            </>
          ) : (
            "Load more"
          )}
        </button>
      )}
    </div>
  );

  const hasLeading = leadingColumns != null && leadingColumns.length > 0;
  // HEL-1307 -- rules resolve on the RAW row value (never the formatted text), per row object.
  const ruledColumns = useMemo(
    () => withCellRules(formattedColumns, conditionalFormats),
    [formattedColumns, conditionalFormats],
  );
  const gridRowClassName = useMemo(
    () => withRowRules(rowClassName, conditionalFormats),
    [rowClassName, conditionalFormats],
  );
  const gridColumns = useMemo<ColumnDef[]>(
    () =>
      hasLeading
        ? [...leadingColumns.map((c) => ({ ...c, inert: true })), ...ruledColumns]
        : ruledColumns,
    [hasLeading, leadingColumns, ruledColumns],
  );

  if (usingPagination || usingRaw) {
    return (
      <div className="panel-content panel-content--table">
        <DataGrid
          variant="full"
          rows={displayRows}
          columns={gridColumns}
          rowClassName={gridRowClassName}
          columnWidths={widths}
          onColumnResize={handleColumnResize}
          sort={sortState.key === UNSORTED_SENTINEL ? null : sortState}
          onSort={handleSort}
          filters={filters}
          onFilterChange={handleFilterChange}
          pinnedColumns={pinnedKeys}
          onPinToggle={hasLeading || disablePinning ? undefined : handlePinToggle}
          emptyText={emptyText}
          emptyAction={emptyAction}
        />
        {/* HEL-451 skeptic CR7 — ONE render site for every non-empty
            disclosure state (previously split: the unqualified-count case
            rendered ABOVE the grid, the truncated cases BELOW it, so the
            same message jumped position depending on `rowsTruncated`). */}
        {showTruncationWrapper && (
          <div className="panel-content__disclosure">
            {/* HEL-448 design D9a / HEL-451 design D4b, D4c, D10a — see
                LoadedScopeDisclosure.tsx's file-level comment: CONFIRMED by
                the owner, kept behind one removal seam as good structure,
                not as a placeholder pending approval. */}
            <LoadedScopeDisclosure
              // HEL-1027 design.md D5/D7 (task 5.2) — once server-side filtering ships,
              // `matchCount` is the Output-WIDE filtered total (`totalRowCount`), which is never
              // "partial" relative to itself — always `rowsTruncated={false}` here so the
              // component's own `filtering` branch collapses to the single "{total} results."
              // wording (never "N of M loaded rows match", now-removed stale phrasing). Falls
              // back to the currently-loaded/filtered count when `totalRowCount` is unavailable
              // (a caller with no pagination — D7's client-side-fallback-only path).
              rowsTruncated={totalRowCount === undefined && rowsTruncated}
              filtering={filtering}
              matchCount={totalRowCount ?? filteredRows.length}
              loadedCount={normalizedRows.length}
            />
            {/* `rowsTruncated &&` is kept even though the dashboard grid
                cannot currently reach the `rawRows` branch (design D4b: both
                `rawRows`/`paginationRows` derive from one `paginationEntry
                .rows`, so one being non-empty implies the other is too) —
                this gate stays CORRECT if that derivation is ever decoupled,
                and `PanelCardBody.tsx` passes `onLoadMore` UNCONDITIONALLY, so
                `onLoadMore != null` alone would render a live button on
                every FULLY-LOADED dashboard panel. Do not "simplify" this
                away. */}
            {showLoadMoreBtn && (
              <button
                className="panel-content__load-more-btn"
                onClick={onLoadMore}
                disabled={paginationIsLoadingMore}
                aria-busy={paginationIsLoadingMore}
              >
                {paginationIsLoadingMore ? (
                  <>
                    <Spinner size="sm" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="panel-content panel-content--table">
      <table className="panel-content__table" aria-hidden="true">
        <thead>
          <tr>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}
