import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import "./DataGrid.css";
// HEL-448 design D4: `SortableTh` cannot be rendered directly here (it puts
// the resize `<span>` inside an invalid nested-interactive `<button>`, and
// exposes no `style` prop for the column-width mechanism below), but its
// classes ARE reused verbatim so the panel table and the list tables cannot
// drift apart visually — importing its CSS here keeps that true regardless
// of whether a `SortableTh` happens to be mounted elsewhere on the page.
import "./SortableTh.css";
import { IconButton } from "./IconButton";
import { useScrollEdges } from "./useScrollEdges";
import { useVirtualRows } from "./useVirtualRows";
import type { SortDirection, SortState } from "./useSortedRows";
import { ArrowUpDown, ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import { ICON_SIZE } from "./iconSize";

export interface ColumnDef {
  key: string;
  /** Column header text; defaults to `key` when omitted. */
  header?: string;
  /** Overrides the default cell formatter for this column. */
  render?: (row: Record<string, unknown>, value: unknown) => ReactNode;
  width?: string | number;
  /** HEL-469 design D3a — header+cell text alignment, applied to the `th`
   *  AND `td` TOGETHER (owner-ruled; never one without the other). Absent
   *  keeps today's behavior (`th` left-aligned by CSS, `td` inherits). */
  align?: "left" | "right";
}

type DataGridVariant = "full" | "preview";
type DataGridDensity = "condensed" | "normal" | "spacious";

/** Minimum column width (px) enforced by the drag-resize gesture. */
const MIN_COLUMN_WIDTH = 60;

/**
 * Default width (px) seeded onto any `"full"`-variant column that has
 * neither been resized nor given an explicit `ColumnDef.width` — required
 * once `table-layout: fixed` is engaged (see `DataGrid.css`): fixed layout
 * allocates column widths from the first row's declared widths only and
 * does not fall back to content measurement, so a column left without an
 * explicit width collapses toward ~0px as soon as any sibling column has
 * one (confirmed live in evaluation-1.md, cycle 1 — an untouched column
 * shrank to ~13px). Every `"full"`-variant column gets this fallback so
 * unresized columns render at a stable, reasonable width instead.
 */
const DEFAULT_COLUMN_WIDTH = 160;

/** Width (px) nudged per arrow-key press while a resize handle is focused —
 * the keyboard-operable equivalent of the drag gesture (DESIGN.md §8). */
const KEYBOARD_RESIZE_STEP = 10;

/**
 * HEL-451 design D10-12 (owner-ruled), CORRECTED AGAIN (skeptic-evaluator
 * cycle 4) — the height, measured against `.ui-data-grid__frame`'s OWN
 * `clientHeight` (not `.panel-content`'s and not the panel item's — both
 * include title-bar/footer/disclosure amounts that have nothing to do
 * with whether the CHROME ITSELF fits, exactly the confusion that
 * produced D10-3a's withdrawn "~200px against ~140px" arithmetic), below
 * which the ADDITIONAL filter chrome (quick-filter row, per-column filter
 * row) defaults to COLLAPSED rather than expanded, even when a persisted
 * filter is already active.
 *
 * **Cycle-3's 151px was wrong, and wrong in the D10-3a shape: not a
 * number slightly off, but the wrong term set summed.** It excluded the
 * filtered-empty message as "separately bounded" — true only of the
 * COMPACT message (44px, `line-clamp`-bounded). But when the app auto-
 * EXPANDS at ≥151px, the message ALSO reverts to its full, unclamped
 * form (86px measured live, evaluation-3.md) — so the real chrome the
 * app must hold in the filtered-empty state, right at its own threshold,
 * is `37 + 37 + 86 = 160px`, already more than 151px, before the grid
 * itself has ANY room. Reproduced live with no forced styles: a 167px
 * modal frame auto-expanded and crushed `.ui-data-grid` to 7px — header
 * row and every per-column filter input present in the DOM, invisible in
 * a 7px sliver.
 *
 * This threshold now governs the WORST state it must hold: the app
 * auto-expanding into a filtered-empty (full message) result, with the
 * grid still keeping a header row and one per-column filter input
 * usable. Both are load-bearing per D10-12; do not shrink this back to
 * "chrome only" or "message only" — this is the derivation D10-3a and
 * cycle-3's threshold both got wrong the same way.
 *
 * Derived from measured heights (evaluation-2.md + evaluation-3.md +
 * evaluation-4.md, live-measured, not guessed):
 * - toolbar: 37px (always rendered when `filterable`)
 * - quick-filter row: 37px (only when the additional rows are expanded)
 * - FULL (unclamped) filtered-empty message: 86px (evaluation-3.md,
 *   measured live) — the worst case the threshold must hold, since the
 *   compact 44px form only applies below this same threshold
 * - minimum usable grid height (one header row + one per-column filter
 *   input): **79.5px, measured live (evaluation-4.md)** — NOT the header
 *   row's own 34.5px doubled. That was a THIRD assumed threshold term in
 *   this ticket (after D10-3a's withdrawn arithmetic and cycle-3's
 *   143px), corrected by measurement rather than left as a plausible
 *   guess: the per-column filter row is NOT "the same recipe as the
 *   header row" height-wise — it carries `<input>` elements, and measures
 *   **45px**, not ~34.5px. Header (34.5) + per-column row (45) = 79.5px.
 *   This is ALSO the `GRID_MIN_USABLE_HEIGHT_PX` floor enforced in CSS
 *   below (D10-12's second, independent remedy)
 *
 * Honest expanded floor: 37 + 37 + 86 + 79.5 = 239.5px. Plus one
 * `--space-2` (8px) buffer for measurement/rounding slack, matching the
 * same methodology as the withdrawn 151px derivation = **247.5px**.
 *
 * **Accepted consequence (owner-ruled, not a regression, D10-12).** The
 * dashboard panel's grid-layout size steps mean this raised threshold
 * collapses filters by default at the enforced minimum AND the next step
 * up, expanding only at the third step. This is what auto-collapse is
 * for; it is not tuned away.
 *
 * **Why the grid still needs its OWN CSS floor (D10-12's second remedy,
 * NOT redundant with this constant).** This threshold only governs what
 * the APP chooses to auto-expand into. D10-11 explicitly sanctions a
 * USER overriding the collapsed default by clicking the toggle, even in
 * a panel shorter than 247.5px — and without a floor on `.ui-data-grid`
 * itself, that one click reproduces the identical crushed-grid state,
 * just chosen by the user instead of the app. The threshold makes the
 * broken state UNCHOSEN by the app; the CSS floor (`GRID_MIN_USABLE
 * _HEIGHT_PX`, `.ui-data-grid--full`'s `min-height` in DataGrid.css)
 * makes it UNREACHABLE at all. When the floor pushes chrome past the
 * frame's available height, `.panel-content--table` scrolls — accepted
 * ONLY on this user-override path (D10-11: "a user who expands filters
 * in a short panel gets the expanded chrome and whatever scrolling
 * follows"); the no-scroll invariant still holds in every state the APP
 * itself chooses, which is exactly what this constant protects.
 *
 * **What the test suite does and does not cover for these two constants
 * (skeptic final-gate note, made explicit here rather than left implicit
 * in a gate report).** `DataGrid.test.tsx`'s guards are real and DO catch
 * an INCOHERENT edit — e.g. lowering this threshold alone, or the CSS
 * floor alone, back toward 151/69 while the other stays at its corrected
 * value: the arithmetic guard and the CSS-floor guard both go red. They
 * do NOT catch a COHERENT wrong pair: cycle 4 shipped `69` /
 * `237` — a self-consistent but INSUFFICIENT combination (the CSS in
 * sync with the threshold's own stated derivation, both simply computed
 * from an unmeasured term) — and the ENTIRE suite stayed green against
 * it, because jsdom cannot compute real layout and every guard here
 * checks internal consistency between the constants and the CSS, not
 * whether either is geometrically sufficient. Only a LIVE sweep (a real
 * browser, the actual boundary, both surfaces) can confirm sufficiency.
 * Changing either constant requires that live sweep — a green test run
 * proves the change is internally consistent, never that it is correct.
 */
export const FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 247.5;

/**
 * HEL-451 design D10-12, CORRECTED (skeptic-evaluator cycle 5) — the
 * `min-height` floor `.ui-data-grid--full` carries in DataGrid.css,
 * exported (not read by any OTHER JS at runtime, only by tests) so the
 * two halves of the same measured derivation stay next to each other
 * rather than drifting apart the way `FRAME_FILTER_COLLAPSE_THRESHOLD_PX`'s
 * cycle-3 comment and `filteredEmptyCompact`'s comment already drifted
 * once. One header row (34.5px, D10-7) plus one per-column filter row —
 * **45px, measured live (evaluation-4.md), NOT the header row's own
 * height reused: the per-column row carries `<input>` elements and is
 * genuinely taller.** 34.5 + 45 = 79.5px. Keep this value and
 * DataGrid.css's literal in sync if either measurement changes —
 * `DataGrid.test.tsx` asserts they match syntactically, which is NOT the
 * same as asserting they are geometrically sufficient (see
 * `FRAME_FILTER_COLLAPSE_THRESHOLD_PX`'s own doc comment above for the
 * full statement of that limitation — it applies equally to this
 * constant's own literal).
 *
 * This floor is UNCONDITIONAL — it applies to `.ui-data-grid--full`
 * regardless of the toggle's collapsed/expanded state, not only while
 * expanded. That is why the filtered-empty COLLAPSED floor
 * (`filteredEmptyCompact`'s own doc comment, below) must include this
 * floor's full 79.5px, not just the header row's 34.5px — a mistake this
 * ticket's own `files-modified.md` made once before being corrected.
 */
export const GRID_MIN_USABLE_HEIGHT_PX = 79.5;

/**
 * HEL-458 design D4 — number of rows at or below which the `full` variant
 * renders every row normally with zero windowing engaged. Same order of
 * magnitude as `deriveColumns`'s "first 50 rows" column-sampling heuristic
 * but independently tunable (a different concern: sampling cost vs.
 * rendering cost). Exported so a live-measured revision has one place to
 * change, and so `DataGrid.test.tsx` can size fixtures unambiguously above
 * or below the boundary — a test whose row count sits below the threshold
 * would pass regardless of whether windowing works at all (HEL-1060).
 */
export const VIRTUALIZATION_ROW_THRESHOLD = 150;

/**
 * HEL-458 design D3 — provisional per-density row-height ESTIMATE used only
 * for the pre-measurement render's bounded initial window (never the value
 * windowing math runs on once a real row has been measured). Seeded from
 * each density's own padding/font-size tokens (DataGrid.css): vertical
 * padding (top+bottom) + an approximate line-height for that density's
 * font-size + the 1px `border-bottom` every body cell carries.
 * - `condensed`: 2×`--space-1` (8px) + ~18px line-height (`--text-xs`) + 1px
 * - `normal`: 2×`--space-2` (16px) + ~21px line-height (`--text-sm`) + 1px
 * - `spacious`: 2×`--space-3` (24px) + ~24px line-height (`--text-base`) + 1px
 * The `useLayoutEffect` below corrects this to the real measured value from
 * the first mounted body row before paint (mirrors the existing
 * `headerRowRef` measurement pattern) — this estimate only governs how many
 * rows the very first render mounts.
 */
const ROW_HEIGHT_ESTIMATE_PX: Record<DataGridDensity, number> = {
  condensed: 27,
  normal: 38,
  spacious: 49,
};

interface DataGridProps {
  rows: Record<string, unknown>[];
  /** Optional explicit columns; defaults to the union of keys across the first 50 rows. */
  columns?: ColumnDef[];
  variant: DataGridVariant;
  /**
   * Cell density — controls row padding and font size (line-height scales
   * proportionally with font size):
   * - `"condensed"` — `--space-1`/`--space-2` padding, `--text-xs` font.
   * - `"normal"` — `--space-2`/`--space-3` padding, `--text-sm` font.
   * - `"spacious"` — `--space-3`/`--space-4` padding, `--text-base` font.
   *
   * Defaults per `variant` when omitted: `preview` → `"condensed"`, `full` →
   * `"normal"`. Consumers should rely on this default rather than pass an
   * explicit `density` unless the surface has a documented reason to diverge
   * from its variant's default (e.g. a denser full-variant surface).
   */
  density?: DataGridDensity;
  /**
   * Applied column widths (px), keyed by column `key` — overrides a column's
   * `width`/derived width when present. Only consulted in the `"full"`
   * variant; ignored (along with `onColumnResize`) in `"preview"`.
   */
  columnWidths?: Record<string, number>;
  /**
   * Fired as the user drags a column's resize handle, reporting the live
   * width for that column. Only wired up in the `"full"` variant — `DataGrid`
   * itself does not persist anything; the caller owns storage. See HEL-253.
   */
  onColumnResize?: (key: string, width: number) => void;
  /**
   * Current sort state, or `null`/omitted for no active sort. Only rendered
   * in the `"full"` variant, and only when `onSort` is also supplied — see
   * HEL-448 design D4/D1. `DataGrid` never orders rows itself; the caller
   * (`TableRenderer`, via `useSortedRows`) owns ordering, exactly like
   * `columnWidths`/`onColumnResize` above.
   */
  sort?: SortState<string> | null;
  /** Fired when a sortable header is activated (click or Enter/Space). */
  onSort?: (key: string) => void;
  /** Empty-state message shown instead of a table when `rows` is empty. */
  emptyText?: string;
  /** Content rendered beneath the empty-state message (e.g. a "Clear
   *  filters" button) — HEL-451 design D5. A slot rather than typed props so
   *  `DataGrid` stays presentational and does not learn what a filter is.
   *  Ignored on the un-filtered empty path when `filters` has no active
   *  term (see `DataGridProps.filters`), matching today's behavior exactly. */
  emptyAction?: ReactNode;
  /**
   * Current filter term values, or omitted for no active filter. Only
   * rendered in the `"full"` variant, and only when `onFilterChange` is
   * also supplied — mirrors `sort`/`onSort` above (HEL-451 design D1/D5).
   * `DataGrid` never decides which rows match; it renders the controls and
   * reports changes, exactly like `columnWidths`/`onColumnResize`.
   */
  filters?: { quick?: string; columns?: Record<string, string> };
  /** Fired when the quick-filter or a per-column filter input changes,
   *  reporting the FULL next `filters` value (not a diff). */
  onFilterChange?: (next: { quick?: string; columns?: Record<string, string> }) => void;
  /**
   * HEL-465 — a leading prefix of the `columns` array `DataGrid` was given
   * (design.md Decision 1 ownership split: `DataGrid` has no `columnOrder`
   * prop, so it never derives this itself — the caller, `TableRenderer`,
   * owns re-deriving it on reorder). Only rendered in the `"full"` variant;
   * ignored on `"preview"`. Pinned entries not found as a leading, contiguous
   * run of `columns` (by key) are treated as unpinned — `DataGrid` never
   * renders a gap.
   */
  pinnedColumns?: string[];
  /**
   * Fired when a column header's pin/unpin control is activated (click or
   * keyboard). `DataGrid` reports only the target column's key; computing
   * the next leading-run pinned set (design.md Decision 1) is the caller's
   * responsibility (`TableRenderer`, task 3.3) — mirrors `onColumnResize`/
   * `onSort` in leaving all persistence/derivation to the caller. Only wired
   * up in the `"full"` variant.
   */
  onPinToggle?: (key: string) => void;
  className?: string;
}

/**
 * HEL-465 design.md Decision 1/4 — number of leading `columns` entries that
 * are pinned. `pinnedColumns` is a set of keys, but pin state is only ever a
 * CONTIGUOUS leading run (Decision 1); this walks `columns` from the front
 * and stops at the first key not present in `pinnedColumns`, so a caller
 * that (incorrectly) passes a non-contiguous or non-leading set never
 * produces a visual gap — it degrades to "however much of the front matches".
 */
function pinnedCount(columns: ColumnDef[], pinnedColumns: string[] | undefined): number {
  if (!pinnedColumns || pinnedColumns.length === 0) return 0;
  const pinnedSet = new Set(pinnedColumns);
  let count = 0;
  for (const col of columns) {
    if (!pinnedSet.has(col.key)) break;
    count += 1;
  }
  return count;
}

/**
 * HEL-465 design.md Decision 4 — sticky-left offset for each pinned column,
 * reusing the EXACT fallback chain `appliedWidth` (below) already uses for
 * rendering width (`liveWidths ?? columnWidths ?? col.width ??
 * DEFAULT_COLUMN_WIDTH`), so a pinned column's offset never drifts from what
 * it is actually rendered at. Density-agnostic by construction (design.md
 * Decision 7) — it only sums widths, never padding. Pure and exported for
 * Jest coverage (task 5.1); not a React hook, so it takes no dependency
 * array of its own — callers recompute it inline on every render, which is
 * cheap at panel column counts.
 */
export function computePinnedOffsets(
  columns: ColumnDef[],
  count: number,
  liveWidths: Record<string, number>,
  columnWidths: Record<string, number> | undefined,
): Record<string, number> {
  const offsets: Record<string, number> = {};
  let running = 0;
  for (let i = 0; i < count; i++) {
    const col = columns[i];
    offsets[col.key] = running;
    const width =
      liveWidths[col.key] ?? columnWidths?.[col.key] ?? col.width ?? DEFAULT_COLUMN_WIDTH;
    const numericWidth = typeof width === "number" ? width : Number(width);
    running += Number.isFinite(numericWidth) ? numericWidth : DEFAULT_COLUMN_WIDTH;
  }
  return offsets;
}

const DEFAULT_DENSITY: Record<DataGridVariant, DataGridDensity> = {
  preview: "condensed",
  full: "normal",
};

/** Natural/numeric comparator for column keys — plain string sort would
 *  order "col_10" before "col_2", which is confusing for any real dataset
 *  with numeric-suffixed or numeric field names (see HEL a11y/ux sweep
 *  F-127). Module-level singleton: `Intl.Collator` construction is not free
 *  and this comparator is stateless. `TableRenderer.tsx`'s `deriveKeys`
 *  mirrors this exact fix — the two must stay in sync (see its docstring). */
const naturalKeyCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Union of keys across the first 50 rows, in natural/numeric order — matches
 * `PreviewTable`'s former column-derivation behavior, plus the F-127 fix. */
function deriveColumns(rows: Record<string, unknown>[]): ColumnDef[] {
  const seen = new Set<string>();
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return Array.from(seen)
    .sort((a, b) => naturalKeyCollator.compare(a, b))
    .map((key) => ({ key }));
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Canonical table-shaped data primitive. Renders `rows`/`columns` as a table
 * with shared empty-state, cell-formatting, and density behavior — replaces
 * the app's previously-duplicated per-surface table markup (see HEL-251). */
export function DataGrid({
  rows,
  columns,
  variant,
  density,
  columnWidths,
  onColumnResize,
  sort,
  onSort,
  emptyText = "No data to preview.",
  emptyAction,
  filters,
  onFilterChange,
  pinnedColumns,
  onPinToggle,
  className,
}: DataGridProps) {
  const resolvedColumns = useMemo(() => columns ?? deriveColumns(rows), [rows, columns]);
  const resolvedDensity = density ?? DEFAULT_DENSITY[variant];
  const resizable = variant === "full";
  const sortable = variant === "full" && onSort != null;
  const filterable = variant === "full" && onFilterChange != null;
  // HEL-465: `preview` never renders sticky-left columns (ticket Out of
  // Scope), regardless of what `pinnedColumns` is passed.
  const pinnable = variant === "full";
  // HEL-451 design D5: whether ANY filter term is active — drives both the
  // filtered-empty markup shape and (via `emptyAction`, supplied by the
  // caller) whether the empty state offers a way out.
  const quickTerm = filters?.quick ?? "";
  // Stable across renders where `filters.columns` itself hasn't changed
  // identity — the fallback `{}` literal below would otherwise be a fresh
  // object every render, which is exactly what defeats the two `useCallback`
  // deps below (react-hooks/exhaustive-deps).
  const rawColumnTerms = filters?.columns;
  const columnTerms = useMemo(() => rawColumnTerms ?? {}, [rawColumnTerms]);
  const filtering =
    quickTerm.trim() !== "" || Object.values(columnTerms).some((t) => t.trim() !== "");
  // HEL-451 design D4d: the quick filter counts as one, matching "the quick
  // filter counts as one" in the ruling verbatim.
  const activeFilterCount =
    (quickTerm.trim() !== "" ? 1 : 0) +
    Object.values(columnTerms).filter((t) => t.trim() !== "").length;

  // HEL-451 design D4d — ruled after live measurement: two full-width filter
  // rows on top of the header row cost 124.5px of a 143px scroll area,
  // leaving ~18px for a 35px data row. Both rows sit behind ONE toggle. The
  // toggle row itself (task 3c.2) is ALWAYS rendered when `filterable`, so
  // an active filter is never invisible even collapsed — it shows the count
  // and offers "Clear all" without expanding. Seeded ONCE from whether a
  // filter is ALREADY active on first mount (e.g. a persisted `columnFilters`
  // the caller seeded `filters` from) — opening a panel that already has a
  // filter applied should show it, not hide the term behind an extra click;
  // toggling afterwards is independent local UI state and does not re-derive
  // from `filtering` on every filter change (that would fight the user's own
  // collapse). Mirrors HEL-448 D6a's "seeded once" precedent for `columnSort`.
  //
  // HEL-451 design D10-11 (owner-ruled): the seed above is overridden below
  // a measured height threshold, so a persisted filter does not force-expand
  // chrome the enforced minimum panel size cannot hold (evaluation-2's
  // blocking finding). `userToggledFilterExpansionRef` makes the override
  // apply ONLY to the automatic/default decision — "collapse is a default,
  // not a lock": once the user has EXPLICITLY clicked the toggle (either
  // direction), their choice governs from then on regardless of height.
  const [filterExpanded, setFilterExpanded] = useState(() => filtering);
  const userToggledFilterExpansionRef = useRef(false);
  const frameRef = useRef<HTMLDivElement>(null);

  const emitFilterChange = useCallback(
    (next: { quick?: string; columns?: Record<string, string> }) => {
      onFilterChange?.(next);
    },
    [onFilterChange],
  );

  const handleQuickFilterChange = useCallback(
    (e: { target: { value: string } }) => {
      emitFilterChange({ quick: e.target.value, columns: columnTerms });
    },
    [emitFilterChange, columnTerms],
  );

  const handleColumnFilterChange = useCallback(
    (key: string) => (e: { target: { value: string } }) => {
      emitFilterChange({ quick: quickTerm, columns: { ...columnTerms, [key]: e.target.value } });
    },
    [emitFilterChange, quickTerm, columnTerms],
  );

  const handleClearAllFilters = useCallback(() => {
    emitFilterChange({});
  }, [emitFilterChange]);

  // Scroll-shadow affordance (HEL a11y/ux sweep F-164) — a wide table gives a
  // phone user zero indication that more columns exist off-screen otherwise.
  // Declared here (moved up from its previous position below) because the
  // sticky-geometry effect right below also needs `scrollRef` to measure the
  // real scroll VIEWPORT width, not only row heights.
  const { ref: scrollRef, edges: scrollEdges } = useScrollEdges<HTMLDivElement>();

  // HEL-451 design D10 reframe: the filter toolbar and quick-filter row now
  // live OUTSIDE the table entirely (frame chrome, see the render below), so
  // the only sticky row still inside `<thead>` besides the column header is
  // the per-column filter row (`.ui-data-grid__filter-row--columns`, kept in
  // the table per D10-2 — its inputs align to individual columns). It needs
  // exactly ONE measured offset: the column-header row's own height. Offsets
  // are MEASURED, not guessed — jsdom has no real layout engine, so tests
  // stub `getBoundingClientRect` per row (see DataGrid.test.tsx's
  // sticky-offset describe block) exactly like the column-resize gesture
  // above already does for `th` widths.
  //
  // D10-5 deletes the sibling measurement this effect used to also do:
  // `stickyCellMaxWidth`, the scroll-viewport WIDTH bound the three colSpan
  // chrome cells needed while they lived inside `table-layout: fixed`. With
  // no colSpan chrome cell left (the toolbar, quick-filter row, and
  // filtered-empty message are now ordinary viewport-width `<div>`s outside
  // the table), nothing measures a viewport width anymore.
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [columnsRowTop, setColumnsRowTop] = useState(0);

  useLayoutEffect(() => {
    if (!filterable) return;
    const headerHeight = headerRowRef.current?.getBoundingClientRect().height ?? 0;
    // This effect exists specifically to synchronize a React-owned `top`
    // style with an EXTERNAL system — the browser's own layout engine,
    // which is the only thing that knows the header row's real rendered
    // height (density/column-count/content changes are read as
    // dependencies below, not computed here) — the exact "subscribe for
    // updates from some external system" case `react-hooks/set-state-in-effect`
    // exists to allow, not internal derived state that could be computed
    // during render instead. HEL-458 evaluation-1.md non-blocking #2: this
    // site (and the one below) previously carried an explicit
    // `eslint-disable-next-line react-hooks/set-state-in-effect` — removed
    // once HEL-458 added a THIRD `useState` set from a `useLayoutEffect`
    // elsewhere in this component (`measuredRowHeight`), which is when the
    // rule stopped reporting these two pre-existing sites at all (probed:
    // re-adding either directive now fails lint as "unused"). The
    // reasoning above still holds; only the rule's own detection of it
    // changed. Do not re-add the directive.
    setColumnsRowTop(headerHeight);
    // `resolvedColumns.length`/`resolvedDensity` change row heights (more
    // columns can wrap a header, density changes padding/font-size) without
    // changing `filterExpanded` itself, so both are dependencies even
    // though neither is read directly here.
  }, [filterable, filterExpanded, resolvedColumns.length, resolvedDensity]);

  // HEL-451 design D10-11: measure the frame's OWN available height and
  // override the seeded/current `filterExpanded` toward collapsed when it
  // is below the derived threshold — but ONLY while the user has not yet
  // touched the toggle themselves (`userToggledFilterExpansionRef`).
  // `clientHeight === 0` is treated as "unmeasured" rather than "collapse":
  // jsdom never lays out real geometry (it is always 0 unless a test
  // stubs it), and treating it as a genuine zero would force every test —
  // and every render before the browser has painted once — into collapse,
  // silently changing behavior no test asserts against. A real browser
  // reports a nonzero height as soon as it has painted, correctly then
  // MEASURED here in `useLayoutEffect` before the visible paint.
  const applyHeightBasedDefault = useCallback(() => {
    if (userToggledFilterExpansionRef.current) return;
    const frameHeight = frameRef.current?.clientHeight;
    if (frameHeight == null || frameHeight === 0) return;
    const shouldExpand = filtering && frameHeight >= FRAME_FILTER_COLLAPSE_THRESHOLD_PX;
    setFilterExpanded(shouldExpand);
  }, [filtering]);

  useLayoutEffect(() => {
    if (!filterable) return;
    // Same "subscribe for updates from an external system" case as the
    // sticky-offset effect above: this synchronizes React state with the
    // browser's own layout engine (the frame's rendered height), not with
    // internal derived state. See that effect's comment for why no
    // `eslint-disable-next-line react-hooks/set-state-in-effect` sits here
    // even though this pattern would normally want one (HEL-458
    // evaluation-1.md non-blocking #2).
    applyHeightBasedDefault();
  }, [filterable, applyHeightBasedDefault]);

  // Re-checks on every ancestor-driven resize (e.g. dragging a dashboard
  // panel's resize handle, or the panel detail modal changing size) — the
  // mount-time effect above alone would miss a panel resized AFTER mount.
  // Guarded for environments without `ResizeObserver` (jsdom has none).
  useEffect(() => {
    if (!filterable || typeof ResizeObserver === "undefined") return;
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => applyHeightBasedDefault());
    observer.observe(el);
    return () => observer.disconnect();
  }, [filterable, applyHeightBasedDefault]);

  // Transient widths applied while a drag is in progress — `DataGrid` itself
  // does not persist anything (the caller owns storage, see HEL-253
  // design.md), but this keeps the drag visually responsive without waiting
  // on the caller to feed an updated `columnWidths` prop back on every tick.
  const [liveWidths, setLiveWidths] = useState<Record<string, number>>({});
  const dragStateRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const onColumnResizeRef = useRef(onColumnResize);
  useEffect(() => {
    onColumnResizeRef.current = onColumnResize;
  }, [onColumnResize]);

  // HEL-465: recomputed on every render (cheap at panel column counts, see
  // `computePinnedOffsets`'s own doc comment) — always in sync with resize
  // (`liveWidths`/`columnWidths`), pin-set (`pinnedColumns`), or reorder
  // (`resolvedColumns`) changes without needing its own dependency array.
  const numPinned = pinnable ? pinnedCount(resolvedColumns, pinnedColumns) : 0;
  const pinnedOffsets = useMemo(
    () => computePinnedOffsets(resolvedColumns, numPinned, liveWidths, columnWidths),
    [resolvedColumns, numPinned, liveWidths, columnWidths],
  );
  const lastPinnedKey = numPinned > 0 ? resolvedColumns[numPinned - 1]?.key : undefined;

  // HEL-458 design D1-D4: windowing only engages for the `full` variant
  // above the threshold — `preview` (never grows beyond a handful of rows,
  // design.md Non-Goals) and small `full` tables render every row with zero
  // windowing code path engaged (AC3).
  const virtualized = variant === "full" && rows.length > VIRTUALIZATION_ROW_THRESHOLD;
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null);
  const firstBodyRowRef = useRef<HTMLTableRowElement>(null);
  const rowHeight = measuredRowHeight ?? ROW_HEIGHT_ESTIMATE_PX[resolvedDensity];

  useLayoutEffect(() => {
    if (!virtualized) return;
    const measured = firstBodyRowRef.current?.getBoundingClientRect().height;
    if (measured && measured > 0 && measured !== measuredRowHeight) {
      // Same "subscribe for updates from an external system" case as the
      // sticky-offset/filter-height effects above — the browser's own
      // layout engine is the only thing that knows the real rendered row
      // height for the active density.
      setMeasuredRowHeight(measured);
    }
    // `resolvedDensity` invalidates a stale measurement from a prior
    // density (row height is uniform within a density, design.md D1, but
    // not across densities).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualized, resolvedDensity, rows.length]);

  const { startIndex, endIndex, topSpacerPx, bottomSpacerPx } = useVirtualRows({
    scrollRef,
    rowCount: rows.length,
    rowHeight,
    enabled: virtualized,
  });
  const visibleRows = virtualized ? rows.slice(startIndex, endIndex) : rows;
  const showTopSpacer = virtualized && topSpacerPx > 0;
  // HEL-458 design D6: omit the trailing spacer entirely at height 0 (the
  // common case at the bottom of the scroll range) — a zero-height spacer
  // `<tr>` would still retarget `tbody tr:last-child`'s border-suppression
  // rule away from the true last data row.
  const showBottomSpacer = virtualized && bottomSpacerPx > 0;
  // HEL-458 design D5: `aria-rowcount` is header-inclusive and applies
  // identically below the threshold (no spacers, same formula).
  const ariaRowCount = rows.length + 1;

  // Drag gesture: mousedown on the handle starts tracking, mousemove reports
  // the live width, mouseup tears the listeners back down. `onMove`/`onEnd`
  // are created fresh per drag (a low-frequency event) rather than memoized
  // hooks, so neither needs to forward-reference the other.
  const handleResizeStart = useCallback(
    (key: string) => (e: ReactMouseEvent<HTMLSpanElement>) => {
      // Defense-in-depth (HEL-253 design.md): stop propagation before an
      // ancestor drag/resize listener (e.g. PanelGrid's card-level drag
      // handle) can ever see this mousedown.
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const startWidth = th ? th.getBoundingClientRect().width : MIN_COLUMN_WIDTH;
      dragStateRef.current = { key, startX: e.clientX, startWidth };

      function onMove(moveEvent: MouseEvent) {
        const drag = dragStateRef.current;
        if (!drag) return;
        const delta = moveEvent.clientX - drag.startX;
        const nextWidth = Math.max(MIN_COLUMN_WIDTH, drag.startWidth + delta);
        setLiveWidths((prev) => ({ ...prev, [drag.key]: nextWidth }));
        onColumnResizeRef.current?.(drag.key, nextWidth);
      }

      function onEnd() {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onEnd);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onEnd);
    },
    [],
  );

  const stopPointerPropagation = useCallback((e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
  }, []);

  // Keyboard-operable equivalent of the drag gesture above (DESIGN.md §8):
  // ArrowLeft/ArrowRight nudge the focused column's width by
  // `KEYBOARD_RESIZE_STEP`, clamped to the same `MIN_COLUMN_WIDTH` floor.
  const handleResizeKeyDown = useCallback(
    (key: string) => (e: ReactKeyboardEvent<HTMLSpanElement>) => {
      let delta = 0;
      if (e.key === "ArrowLeft") delta = -KEYBOARD_RESIZE_STEP;
      else if (e.key === "ArrowRight") delta = KEYBOARD_RESIZE_STEP;
      else return;
      e.preventDefault();
      e.stopPropagation();
      const th = (e.currentTarget as HTMLElement).closest("th");
      const currentWidth = th ? th.getBoundingClientRect().width : MIN_COLUMN_WIDTH;
      const nextWidth = Math.max(MIN_COLUMN_WIDTH, currentWidth + delta);
      setLiveWidths((prev) => ({ ...prev, [key]: nextWidth }));
      onColumnResizeRef.current?.(key, nextWidth);
    },
    [],
  );

  // HEL-451 design D5: the un-filtered empty path is UNCHANGED — a bare
  // message, no table at all, so every pre-existing consumer (StepCard,
  // SqlTab, SourceDetailPanel, and TableRenderer itself when nothing is
  // filtering) renders exactly as before. Only a FILTERED empty result falls
  // through to the full grid shell below, so the filter row stays visible
  // and the term that produced zero rows can be seen and edited (task 3.4).
  if (rows.length === 0 && !filtering) {
    const emptyClasses = ["ui-data-grid__empty", className ?? null].filter(Boolean).join(" ");
    // No `emptyAction` → the exact pre-HEL-451 markup (a bare <p>, no
    // wrapper), so every existing non-panel consumer (StepCard, SqlTab,
    // SourceDetailPanel) is provably unaffected — task 3.3.
    if (!emptyAction) return <p className={emptyClasses}>{emptyText}</p>;
    return (
      <div className="ui-data-grid__empty-wrap">
        <p className={emptyClasses}>{emptyText}</p>
        {emptyAction}
      </div>
    );
  }

  const rootClasses = [
    "ui-data-grid",
    `ui-data-grid--${variant}`,
    `ui-data-grid--${resolvedDensity}`,
    scrollEdges.left ? "ui-data-grid--scroll-left" : null,
    scrollEdges.right ? "ui-data-grid--scroll-right" : null,
    className ?? null,
  ]
    .filter(Boolean)
    .join(" ");

  // HEL-451 design D10-2/D10-4: the frame carries the density modifier too
  // — `.ui-data-grid--condensed` etc. moved from an ANCESTOR of the chrome
  // (`.ui-data-grid .ui-data-grid__table th`) to a SIBLING once the frame
  // was introduced, so it can no longer reach the toolbar/quick-filter by
  // descendant selector. Mirroring the modifier onto the frame keeps the
  // chrome responding to density exactly as it did before the reframe.
  //
  // HEL-451 design D10-3a: the frame ALSO carries the variant modifier
  // (`ui-data-grid--full`), mirrored the same way — `.ui-data-grid--full`
  // (DataGrid.css) is `flex: 1; min-height: 0`, which must resolve against
  // the FRAME (the flex child of `.panel-content--table`), not the scroll
  // container nested inside it. Without this, the frame has no definite
  // height, `.ui-data-grid` never gets a vertical cap, it stops scrolling
  // vertically, and `position: sticky` on the header/filter rows silently
  // stops engaging (D10-7) — the exact highest-risk, no-red-test failure
  // mode D10-3a names. `--preview` gets no frame-level flex rule and stays
  // layout-neutral (its own `max-height: 320px` stays on the scroll
  // container, per D10-3a).
  const frameClasses = [
    "ui-data-grid__frame",
    `ui-data-grid__frame--${variant}`,
    `ui-data-grid--${resolvedDensity}`,
  ]
    .filter(Boolean)
    .join(" ");

  // HEL-451 design D10-11, CORRECTED (skeptic-evaluator cycle 3 CR1,
  // BLOCKING): an earlier revision of this line also gated the
  // filtered-empty message on `filterExpanded`, on the reasoning that its
  // variable height was what made the collapse threshold's arithmetic
  // close. That was wrong, and it recreated the exact defect this ticket
  // exists to fix: `TableRenderer.tsx`'s "DataGrid owns every EMPTY state
  // unconditionally" contract means a collapsed panel with a filter
  // matching nothing rendered NOTHING explaining why — a filter matching
  // nothing presenting as a confident, wrong (silent) answer, exactly in
  // the state D10-11's own ruling says must not happen.
  //
  // The message renders in BOTH expansion states, ungated — it is the one
  // thing that must survive collapse. What DOES vary by state is its
  // PRESENTATION (`filteredEmptyCompact` below), which is how the
  // threshold arithmetic stays honest without suppressing the explanation.
  const filteredEmpty = rows.length === 0 && filtering;
  // HEL-451 design D10-11/D10-12: when collapsed, the message renders in a
  // COMPACT form — the text clamped to one line (CSS `line-clamp`, full
  // text still in the `title` attribute) plus the action row, rather than
  // the full multi-line wrapped text. This bounds its height at **44px,
  // measured live** (evaluation-3.md — this comment previously said
  // "~36px", a stale estimate never reconciled against the constant's own
  // derivation; the two disagreeing in-tree is the same confidently-false-
  // comment problem this ticket has already hit once) regardless of
  // `emptyText`'s actual length. CORRECTED (skeptic-evaluator final gate,
  // after cycle 5): the collapsed floor is toolbar (37) + compact message
  // (44) + `.ui-data-grid--full`'s OWN `min-height` floor (79.5px,
  // `GRID_MIN_USABLE_HEIGHT_PX`, D10-12 — that floor is UNCONDITIONAL, not
  // scoped to the expanded state, so it applies here too even though the
  // per-column row itself never renders when collapsed) = **160.5px** —
  // NOT 115.5px, an earlier figure that only summed the header row's own
  // 34.5px and never accounted for the grid's unconditional CSS floor.
  // Measured live: this is ~1.5px over the app's enforced minimum
  // `.panel-content--table` height (159px, evaluation-2), which the
  // skeptic confirmed resolves as a small (~10px) scroll of
  // `.panel-content--table` at that exact minimum — nothing user-facing
  // hidden, the CSS floor doing exactly its job. Not a regression: it is
  // the CSS floor (D10-12's second remedy) correctly refusing to let the
  // grid shrink below one usable row, applied consistently whether the
  // toggle is collapsed or expanded. The EXPANDED state's message is the
  // full, unclamped text — up to 86px measured live (evaluation-3.md);
  // the collapse THRESHOLD above is derived to hold that full-message
  // height, and the same `min-height` floor keeps the grid usable even in
  // the one state the threshold cannot prevent — a user manually
  // overriding the collapsed default in a panel shorter than the
  // threshold, which D10-11 explicitly sanctions.
  const filteredEmptyCompact = filteredEmpty && !filterExpanded;

  return (
    <div className={frameClasses} ref={frameRef}>
      {/* HEL-451 design D10-2: ALL frame chrome precedes the scroll
          container — the toolbar, the quick-filter row, AND the
          filtered-empty message. The fold is set by the SCROLLER's height
          (D10-3a), not the table's, so placing any of this chrome after
          the scroll container risked it falling below the fold in exactly
          the state this ticket calls sharpest (a filter matching nothing).
          This ALSO replaces the previous `colSpan` chrome cells inside the
          table (D10-5): as ordinary block-level chrome, none of it is
          bound by `table-layout: fixed` column geometry, the `tbody td`
          truncation group, or a sticky containing-block confounded by
          ancestor `overflow: hidden` — the three coupled invariants that
          produced three consecutive final-gate findings on the same
          element. */}
      {filterable && (
        <div className="ui-data-grid__filter-toolbar">
          <button
            type="button"
            className={`ui-data-grid__filter-toggle-btn${
              filtering ? " ui-data-grid__filter-toggle-btn--active" : ""
            }`}
            aria-expanded={filterExpanded}
            onClick={() => {
              // HEL-451 design D10-11: an explicit click is the user
              // overriding the automatic height-based default from here on
              // — "collapse is a default, not a lock".
              userToggledFilterExpansionRef.current = true;
              setFilterExpanded((v) => !v);
            }}
          >
            Filters{filtering ? ` (${activeFilterCount})` : ""}
          </button>
          {filtering && (
            <button
              type="button"
              className="ui-data-grid__filter-clear-all-btn"
              onClick={handleClearAllFilters}
            >
              Clear all
            </button>
          )}
        </div>
      )}
      {filterable && filterExpanded && (
        <div className="ui-data-grid__quick-filter-row">
          <input
            type="text"
            className="ui-data-grid__filter-input ui-data-grid__filter-input--quick"
            aria-label="Quick filter across all columns"
            placeholder="Filter all columns…"
            value={quickTerm}
            onChange={handleQuickFilterChange}
          />
        </div>
      )}
      {filteredEmpty && (
        <div
          className={`ui-data-grid__filtered-empty${
            filteredEmptyCompact ? " ui-data-grid__filtered-empty--compact" : ""
          }`}
        >
          <p className="ui-data-grid__empty" title={filteredEmptyCompact ? emptyText : undefined}>
            {emptyText}
          </p>
          {emptyAction}
        </div>
      )}
      <div className={rootClasses} role="region" aria-label="Data grid" ref={scrollRef}>
        <table className="ui-data-grid__table" aria-rowcount={ariaRowCount}>
          <thead>
            <tr ref={headerRowRef} className="ui-data-grid__header-row" aria-rowindex={1}>
              {resolvedColumns.map((col, index) => {
                const appliedWidth = resizable
                  ? (liveWidths[col.key] ??
                    columnWidths?.[col.key] ??
                    col.width ??
                    DEFAULT_COLUMN_WIDTH)
                  : col.width;
                // HEL-448 design D4: this direction lookup, the `aria-sort`
                // vocabulary, and the glyph choice below mirror `SortableTh`
                // exactly — reused as an inline `<button>` rather than the
                // component itself, because `SortableTh` renders `children`
                // INSIDE that `<button>` (the resize `<span>` below cannot
                // nest there) and exposes no `style` prop for `appliedWidth`.
                const direction: SortDirection | null =
                  sortable && sort?.key === col.key ? sort.direction : null;
                const ariaSort = !sortable
                  ? undefined
                  : direction === "asc"
                    ? "ascending"
                    : direction === "desc"
                      ? "descending"
                      : "none";
                // HEL-465 design.md Decision 1/3/5: pinned header cells are
                // doubly-sticky (top from the pre-existing header-row
                // behavior, left from this ticket) — z-index 3, the highest
                // tier. Non-pinned header cells stay at z-index 2 (singly
                // top-sticky), unaffected by this ticket other than the
                // tier number now being explicit.
                const isPinned = index < numPinned;
                const isLastPinned = col.key === lastPinnedKey;
                // HEL-465 skeptic-final-4 CR1 (BLOCKING, last round) — the
                // header label needs its own right padding reserved
                // whenever the pin toggle renders in this `<th>` (exactly
                // `pinnable && onPinToggle`, the same condition gating the
                // toggle itself below), or the label's `text-overflow:
                // ellipsis` never engages before the icon and the label
                // paints UNDERNEATH it on a truncating column instead —
                // measured live at 8/73 bare, 28/75 once several columns
                // are pinned (the feature's own normal state). See
                // `.ui-data-grid__th--pin-reserve` (DataGrid.css) for the
                // reserved width's derivation.
                const headerClasses = [
                  isPinned ? "ui-data-grid__pinned-cell" : null,
                  isPinned && isLastPinned ? "ui-data-grid__pinned-cell--last" : null,
                  pinnable && onPinToggle ? "ui-data-grid__th--pin-reserve" : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <th
                    key={col.key}
                    title={col.header ?? col.key}
                    className={headerClasses || undefined}
                    style={{
                      ...(appliedWidth !== undefined ? { width: appliedWidth } : undefined),
                      ...(col.align ? { textAlign: col.align } : undefined),
                      ...(isPinned ? { left: pinnedOffsets[col.key], zIndex: 3 } : undefined),
                    }}
                    aria-sort={ariaSort}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="sortable-th__btn"
                        onClick={() => onSort?.(col.key)}
                      >
                        <span className="sortable-th__label">{col.header ?? col.key}</span>
                        {direction === "asc" ? (
                          <ChevronUp
                            className="sortable-th__glyph"
                            aria-hidden="true"
                            size={ICON_SIZE.sm}
                          />
                        ) : direction === "desc" ? (
                          <ChevronDown
                            className="sortable-th__glyph"
                            aria-hidden="true"
                            size={ICON_SIZE.sm}
                          />
                        ) : (
                          <ArrowUpDown
                            className="sortable-th__glyph sortable-th__glyph--neutral"
                            aria-hidden="true"
                            size={ICON_SIZE.sm}
                          />
                        )}
                      </button>
                    ) : (
                      (col.header ?? col.key)
                    )}
                    {pinnable && onPinToggle && (
                      // HEL-465 design.md Decision 1 consequence/3, CORRECTED
                      // (evaluation-1.md CR1): routed through the shared
                      // `IconButton` primitive (DESIGN.md §5) rather than a
                      // hand-rolled `<button>` — a third, independently-
                      // focusable control (mirrors the resize handle's own
                      // tab stop), not a dropdown menu. `aria-label` states
                      // "pin through" whenever activating it would newly pin
                      // more than one column (every unpinned column ahead of
                      // this one, per Decision 1's leading-run constraint) —
                      // computed here from `numPinned`/`index` since both are
                      // already known to `DataGrid` without needing
                      // `columnOrder` itself. `title` is deliberately SHORTER
                      // and distinct from `aria-label` — without it, the
                      // enclosing `<th title={col.header}>`'s tooltip would
                      // show through, naming the COLUMN rather than the
                      // ACTION (evaluation-1.md CR1).
                      <IconButton
                        icon={
                          isPinned ? <PinOff size={ICON_SIZE.sm} /> : <Pin size={ICON_SIZE.sm} />
                        }
                        variant="ghost"
                        size="xs"
                        className="ui-data-grid__pin-toggle-btn"
                        aria-pressed={isPinned}
                        aria-label={
                          isPinned
                            ? `Unpin column ${col.header ?? col.key}`
                            : index - numPinned > 0
                              ? `Pin through column ${col.header ?? col.key}`
                              : `Pin column ${col.header ?? col.key}`
                        }
                        title={isPinned ? "Unpin" : "Pin"}
                        onClick={() => onPinToggle(col.key)}
                      />
                    )}
                    {resizable && (
                      <span
                        className="ui-data-grid__resize-handle"
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize column ${col.header ?? col.key}`}
                        tabIndex={0}
                        onMouseDown={handleResizeStart(col.key)}
                        onPointerDown={stopPointerPropagation}
                        onKeyDown={handleResizeKeyDown(col.key)}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
            {/* HEL-451 design D10-2: `.ui-data-grid__filter-row--columns`
                STAYS in the table — its inputs align to individual columns,
                so the table is the correct parent (moving it would mirror
                the mistake this reframe fixes). Its sticky `top` is the
                MEASURED column-header row height (design D4e/D10-7) — the
                only sticky row now ABOVE it inside `<thead>`, since the
                toggle row and quick-filter row moved to frame chrome. */}
            {filterable && filterExpanded && (
              <tr className="ui-data-grid__filter-row ui-data-grid__filter-row--columns">
                {resolvedColumns.map((col, index) => {
                  // HEL-465 design.md Decision 5/6: the filter-row corner
                  // cell (a pinned column's filter-input `<th>`, when the
                  // filter row is expanded) is doubly-sticky exactly like
                  // the header corner cell above — same z-index 3 tier.
                  const isPinned = index < numPinned;
                  const isLastPinned = col.key === lastPinnedKey;
                  return (
                    <th
                      key={col.key}
                      className={
                        isPinned
                          ? `ui-data-grid__pinned-cell${isLastPinned ? " ui-data-grid__pinned-cell--last" : ""}`
                          : undefined
                      }
                      style={{
                        top: columnsRowTop,
                        ...(isPinned ? { left: pinnedOffsets[col.key], zIndex: 3 } : undefined),
                      }}
                    >
                      <input
                        type="text"
                        className="ui-data-grid__filter-input"
                        aria-label={`Filter column ${col.header ?? col.key}`}
                        placeholder="Filter…"
                        value={columnTerms[col.key] ?? ""}
                        onChange={handleColumnFilterChange(col.key)}
                      />
                    </th>
                  );
                })}
              </tr>
            )}
          </thead>
          <tbody>
            {/* HEL-451 design D10-6/D10-8: a filtered-empty result renders
                NO `<tr>` at all here — the message is frame chrome above
                (`filteredEmpty`), and the shell (`<thead>`, header row, and
                per-column filter row) still renders so the term that
                produced zero rows stays visible and editable. The un-
                filtered empty case never reaches here (early return above).
                `.ui-data-grid__table tbody:empty` (DataGrid.css) gives this
                state a floor height so it cannot collapse to a 0px sliver. */}
            {showTopSpacer && (
              // HEL-458 design D2/D6: an ordinary flow-layout `<tr>` (not
              // `position: absolute`), so `table-layout: fixed` and HEL-465
              // sticky pinned-column offsets need no special-casing. Hidden
              // from the accessibility tree (D5) — it carries no data.
              <tr aria-hidden="true">
                <td
                  className="ui-data-grid__row-spacer-cell"
                  colSpan={resolvedColumns.length}
                  style={{ height: topSpacerPx }}
                />
              </tr>
            )}
            {visibleRows.map((row, visibleIndex) => {
              const i = startIndex + visibleIndex;
              // HEL-458 design D6: the last mounted data row loses its
              // `:last-child` border-suppression once a nonzero trailing
              // spacer is present (the spacer becomes `:last-child`
              // instead) — apply the suppression explicitly here so
              // windowed and unwindowed renderings stay equivalent.
              const isLastMountedRow = i === endIndex - 1;
              return (
                <tr
                  key={i}
                  ref={visibleIndex === 0 ? firstBodyRowRef : undefined}
                  aria-rowindex={i + 2}
                  className={
                    showBottomSpacer && isLastMountedRow
                      ? "ui-data-grid__row--no-border"
                      : undefined
                  }
                >
                  {resolvedColumns.map((col, index) => {
                    const value = row[col.key];
                    // HEL-465 design.md Decision 4/5/6: pinned body cells are
                    // singly-sticky (left only, z-index 1) — below both sticky
                    // tiers used by the header/filter-row corner cells above,
                    // since a body cell can never spatially overlap them.
                    const isPinned = index < numPinned;
                    const isLastPinned = col.key === lastPinnedKey;
                    return (
                      <td
                        key={col.key}
                        className={
                          isPinned
                            ? `ui-data-grid__pinned-cell${isLastPinned ? " ui-data-grid__pinned-cell--last" : ""}`
                            : undefined
                        }
                        style={{
                          ...(col.align ? { textAlign: col.align } : undefined),
                          ...(isPinned ? { left: pinnedOffsets[col.key], zIndex: 1 } : undefined),
                        }}
                      >
                        {col.render ? col.render(row, value) : formatCell(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {showBottomSpacer && (
              <tr aria-hidden="true">
                <td
                  className="ui-data-grid__row-spacer-cell"
                  colSpan={resolvedColumns.length}
                  style={{ height: bottomSpacerPx }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
