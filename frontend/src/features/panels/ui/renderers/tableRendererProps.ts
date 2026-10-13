import type { ColumnDef } from "../../../../shared/ui/index";
import type { SortDirection, SortState } from "../../../../shared/ui/useSortedRows";
import type { OutputSchemaField } from "../../../pipelines/types/output";
import type {
  TableColumnFilters,
  TableColumnFormats,
} from "../../../pipelines/ui/outputEditor/outputConfigTypes";
import type { FormatIntlOptions } from "./columnFormatting";
import type { ConditionalFormatRule } from "./conditionalFormatting";

export interface TableRendererProps {
  /** Bound Output id — renamed from the pre-HEL-909 `panelId` (this always
   *  carried an Output id despite the name); now also the id `columnSort`
   *  persists against via `updateOutput`. */
  outputId: string;
  /** The Output's owner — used for the HEL-448 D7 pre-check (a
   *  shared-dashboard grantee can sort on screen, but their sort never
   *  writes back, since `updateOutput` is an RLS owner-only write).
   *  HEL-1190 design.md D9 — `null` (never `undefined`) is what
   *  `PublicOutputMeta.ownerId` always is on the public render path, which is
   *  what makes `canWrite` (`TableRenderer.tsx`) structurally false there regardless of the
   *  viewing session's identity. */
  ownerId?: string | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  /** Rows from the paginated execute endpoint (keyed by column name). */
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** HEL-451 design D4: branch-independent truncation signal from
   *  `usePanelData` (`paginationEntry.hasMore`) — the ONLY correct source
   *  for "is the loaded set truncated", on EITHER branch. Must NOT be
   *  re-derived locally as `usingPagination && paginationHasMore`; that was
   *  HEL-448's original (wrong) predicate, false in the panel detail modal
   *  regardless of real truncation. Defaults to `false` only when genuinely
   *  unknown (e.g. in tests that don't pass it). */
  rowsTruncated?: boolean;
  /** Visible-column order from the Output's `TableOutputConfig.columnOrder`;
   *  absent or empty → all columns in natural order. */
  columnOrder?: string[];
  /** Persisted sort from the Output's `TableOutputConfig.columnSort`;
   *  absent/`null` → renders the pipeline's own row order (see
   *  `UNSORTED_SENTINEL` in `tableRendererModel.ts`). */
  columnSort?: SortState<string> | null;
  /** Persisted filter state from the Output's `TableOutputConfig
   *  .columnFilters` (HEL-451 design D1); absent/`null` → no active filter. */
  columnFilters?: TableColumnFilters | null;
  /** Persisted per-column format specs from the Output's
   *  `TableOutputConfig.columnFormats` (HEL-469 design D1a); absent →
   *  every column renders unformatted, exactly as before this ticket. */
  columnFormats?: TableColumnFormats;
  /** Persisted pinned-column set from the Output's
   *  `TableOutputConfig.pinnedColumns` (HEL-465 design.md Decision 1) — a
   *  leading, contiguous run of `columnOrder`'s keys; absent/empty → no
   *  columns pinned. */
  pinnedColumns?: string[];
  /** TEST-ONLY (evaluation-1.md change request 1 / design D4/task 4.0): an
   *  EXPLICIT locale/timeZone override for `resolveColumnFormatter`, never
   *  passed by production code (see `OutputPanelContent.tsx`, which does not set
   *  this prop) — production keeps `Intl`'s locale-aware runtime defaults.
   *  `TableRenderer.test.tsx` passes this explicitly for every assertion
   *  over rendered formatted text, so those tests are pinned the same way
   *  `columnFormatting.test.ts`'s direct formatter tests already are,
   *  rather than inheriting the host's locale (or mutating the `Intl`
   *  global, which design D4/task 4.0 rules out). */
  formatIntl?: FormatIntlOptions;
  /** HEL-1027 design.md D2/D3 (task 4.5) — the bound Output's own declared schema, used ONLY to
   *  gate a column's sort/filter control (never to reorder/reformat anything — that stays
   *  `columnFormats`' job). `undefined` (not passed at all, e.g. an older test) means "no
   *  information" and disables nothing, preserving every pre-existing caller's behavior; an
   *  explicit empty array means "this Output has no declared fields at all" and disables every
   *  column, matching the server's own D2 rule for a legacy/never-analyzed Output. */
  schema?: OutputSchemaField[];
  /** HEL-1027 design.md D4 — fired from the UNCONDITIONAL first half of `handleSort` (alongside
   *  the existing local `toggleSort`), so it runs for every caller regardless of `canWrite`.
   *  `undefined` (no server-side round trip to drive — `PanelDetailModal`,
   *  `PanelFullscreenOverlay`) is a complete no-op via optional chaining. */
  onSortChange?: (column: string, direction: SortDirection | null) => void;
  /** HEL-1027 design.md D4 — same unconditional-first-half contract as `onSortChange` above. */
  onFilterChange?: (filters: TableColumnFilters) => void;
  /** HEL-1027 design.md D5/D7 (task 5.2) — the server's row count for the CURRENT sort/filter
   *  (`PanelPaginationState.total`), used for the loaded-scope disclosure's count so it describes
   *  the WHOLE Output rather than just the currently-loaded page. `undefined` (a caller with no
   *  pagination at all, e.g. the panel detail modal) falls back to the loaded/filtered row count
   *  actually in hand — the D7 "client-side-fallback-only" path. */
  totalRowCount?: number;
  /** HEL-1277 — render-only columns placed before the data columns (the History view's "Change"
   *  marker). Forced `inert` (no sort/filter/resize control) and EXCLUDED from filtering, sorting,
   *  `columnOrder`, widths and every persistence path; rows are never mutated. Supplying any also
   *  disables the pin control (a pinned run must start at the first column). */
  leadingColumns?: ColumnDef[];
  /** HEL-1277 — an extra class for a body row (e.g. a changed-row tint), keyed by row OBJECT, so it
   *  survives the table's own sort/filter. Passed straight through to `DataGrid`. */
  rowClassName?: (row: Record<string, unknown>) => string | undefined;
  /** HEL-1307 — the Output's `conditionalFormats` (table rules: column + cell|row target). Absent/empty →
   *  the table renders exactly as before. */
  conditionalFormats?: ConditionalFormatRule[];
  /** HEL-1277 — hides the pin control (a read-only history table keeps it off for every point,
   *  so it never appears and disappears while scrubbing). */
  disablePinning?: boolean;
}
