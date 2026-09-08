import type { ReactNode } from "react";

import { useScrollEdges } from "./useScrollEdges";
import { SortableTh } from "./SortableTh";
import type { SortState } from "./useSortedRows";

export interface SortableTableColumn<Key extends string> {
  key: Key;
  header: ReactNode;
  /** Forwarded to the underlying `<th>` (each table keeps its own BEM class
   *  family -- this component does no CSS-class translation). */
  className?: string;
}

/** The three class names a scrollable table needs (container + both edge
 *  modifiers). Each caller passes its OWN existing class names (e.g.
 *  `pipeline-list-table__scroll`/`--left`/`--right`) -- this component never
 *  invents or renames classes, so no CSS file needs to change. */
export interface SortableTableScrollClassNames {
  container: string;
  left: string;
  right: string;
}

interface SortableTableProps<Key extends string> {
  /** Class name for the `<table>` element itself. */
  tableClassName: string;
  columns: readonly SortableTableColumn<Key>[];
  sortState: SortState<Key>;
  onSort: (key: Key) => void;
  /** Extra `<th>` cell(s) rendered after the sortable columns -- e.g. an
   *  "Actions" header, which is never itself sortable. Rendered verbatim;
   *  this component does not know or care what it is. */
  trailingHeaderCells?: ReactNode;
  /** Wraps the table in the shared horizontal-scroll-shadow container
   *  (`useScrollEdges`) when provided. OMIT for a table that never needs to
   *  scroll (e.g. `AuditEventTable`) -- no wrapper `<div>` is rendered at
   *  all in that case, not merely an inert one, so a non-scrolling table's
   *  DOM is unchanged by using this component. */
  scrollClassNames?: SortableTableScrollClassNames;
  /** `scrollClassNames` only: when given, marks the scroll wrapper as a
   *  keyboard-focusable scrollable region (`role="region"`, `tabIndex={0}`,
   *  `aria-label`) so a keyboard user who can't drag a scrollbar can still
   *  Tab into the table and use arrow keys to reach a narrow-viewport-only
   *  column (e.g. Connectors' Delete). OMITTED by default -- adding it
   *  unconditionally would change the DOM of every existing caller of this
   *  component, not just a new one that needs it.
   *
   *  The tab stop itself only appears while the table ACTUALLY overflows
   *  (`useScrollEdges`' `overflowing`) -- at a width where the table fits,
   *  there is nothing to scroll to, and an unconditional tab stop would be
   *  a keyboard trap on an inert box (HEL-1022 adversarial review finding
   *  5). */
  scrollAriaLabel?: string;
  /** The `<tbody>` (and any additional per-row markup, e.g. a connector's
   *  conflict row) -- row rendering, click behavior, and Actions cells are
   *  the callers' own concern; this component owns only the shell. */
  children: ReactNode;
}

/**
 * Shared shell for the four section-overview list tables (HEL-1022 follow-up):
 * the scroll-shadow wrapper + `<table>` + `<thead>` built from a `columns`
 * list driving `SortableTh`. Deliberately thin -- row rendering, click
 * behavior, Actions columns, empty states, and one-off extra rows (the
 * Connectors conflict row) all diverge for real reasons across the four
 * tables and are NOT absorbed here; each caller still owns its own `<tbody>`.
 */
export function SortableTable<Key extends string>({
  tableClassName,
  columns,
  sortState,
  onSort,
  trailingHeaderCells,
  scrollClassNames,
  scrollAriaLabel,
  children,
}: SortableTableProps<Key>) {
  // Called unconditionally (rules of hooks) even when `scrollClassNames` is
  // omitted -- the ref simply attaches to nothing in that case, and the
  // wrapper `<div>` itself is never rendered.
  const { ref: scrollRef, edges } = useScrollEdges<HTMLDivElement>();

  function directionFor(key: Key) {
    return sortState.key === key ? sortState.direction : null;
  }

  const table = (
    <table className={tableClassName}>
      <thead>
        <tr>
          {columns.map((column) => (
            <SortableTh
              key={column.key}
              className={column.className}
              direction={directionFor(column.key)}
              onSort={() => onSort(column.key)}
            >
              {column.header}
            </SortableTh>
          ))}
          {trailingHeaderCells}
        </tr>
      </thead>
      {children}
    </table>
  );

  if (!scrollClassNames) return table;

  const classes = [
    scrollClassNames.container,
    edges.left ? scrollClassNames.left : null,
    edges.right ? scrollClassNames.right : null,
  ]
    .filter(Boolean)
    .join(" ");

  const isFocusableRegion = scrollAriaLabel !== undefined && edges.overflowing;

  return (
    <div
      className={classes}
      ref={scrollRef}
      role={isFocusableRegion ? "region" : undefined}
      aria-label={isFocusableRegion ? scrollAriaLabel : undefined}
      tabIndex={isFocusableRegion ? 0 : undefined}
    >
      {table}
    </div>
  );
}
