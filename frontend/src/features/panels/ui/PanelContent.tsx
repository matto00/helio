import "./PanelContent.css";
import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type { MappedPanelData, Panel, PanelAppearance } from "../types/panel";
import type { FilteredMetric } from "../../pipelines/services/outputService";
import type { Output, PublicOutputMeta } from "../../pipelines/types/output";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import type { SortDirection } from "../../../shared/ui/useSortedRows";
import type { TableColumnFilters } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import {
  isDividerPanel,
  isFormPanel,
  isImagePanel,
  isMarkdownPanel,
  isOutputPanel,
  isTextPanel,
} from "../state/panelNarrowing";
import type { CrossFilterMode } from "../hooks/useCrossFilterServerOps";
import { OutputPanelContent } from "./OutputPanelContent";
import { DividerRenderer } from "./renderers/DividerRenderer";
import { FormRenderer } from "./renderers/FormRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
import type { HistorySource } from "../history/useOutputHistory";
import { TextRenderer } from "./renderers/TextRenderer";

export interface PanelContentProps {
  panel: Panel;
  data?: MappedPanelData | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  isLoading?: boolean;
  error?: string | null;
  /** Classification of `error` — drives `InlineError`'s icon/Retry-eligibility. */
  errorKind?: RequestErrorKind | null;
  /** Re-dispatches the failed fetch. Only offered a Retry action when
   *  `errorKind === "error"` (or unset, defaulting to "error"). */
  onRetry?: () => void;
  /** True while a retry triggered by `onRetry` is in flight. */
  retrying?: boolean;
  /** "button" (default) for surfaces with room for a labeled control (the
   *  panel detail modal); "icon-only" for compact surfaces (a grid card). */
  retryVariant?: "button" | "icon-only";
  noData?: boolean;
  /** HEL-946 Bug C(2) — when `noData` is true AND this is also true, the
   *  bound Output's node has never had a successful pipeline run since it
   *  was added (no saved snapshot yet), distinct from a node that ran and
   *  legitimately returned zero rows. Drives a "run the pipeline" message
   *  instead of the generic "No data available" one. */
  neverMaterialized?: boolean;
  /** Navigates to the pipeline so the user can run it, from the
   *  never-materialized empty state (HEL-946). */
  onGoToPipeline?: () => void;
  /** Optional appearance override (defaults to `panel.appearance`). */
  appearance?: PanelAppearance;
  /** Rows from the paginated execute endpoint for table panels. */
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** HEL-451 design D4: branch-independent truncation signal from
   *  `usePanelData` — table panels only (`TableRenderer`'s disclosure).
   *  Passed through unconditionally from BOTH call sites (`PanelCard`,
   *  `PanelDetailModal`); defaults to `false` only when genuinely unknown. */
  rowsTruncated?: boolean;
  /** HEL-301: forwarded to `ChartRenderer` only — see `ChartPanel`'s
   *  `compact` prop. */
  compact?: boolean;
  /** HEL-572: forwarded to `ChartRenderer` (chart-kind output panels only)
   *  — see `ChartPanel`'s `onDataPointSelect` prop. */
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  /** HEL-1027 design.md D4 — forwarded to `TableRenderer` (table-kind output panels only), fired
   *  from the UNCONDITIONAL first half of that component's own `handleSort`/`handleFilterChange`.
   *  Absent for callers with no server-side round trip to drive (`PanelDetailModal`,
   *  `PanelFullscreenOverlay`) — `TableRenderer` optional-chains both, so a missing callback is a
   *  complete no-op there, identical to today's behavior. */
  onSortChange?: (column: string, direction: SortDirection | null) => void;
  onFilterChange?: (filters: TableColumnFilters) => void;
  /** HEL-1027 design.md D5/D7 — the server's row count for the current sort/filter
   *  (`PanelPaginationState.total`), forwarded to `TableRenderer`'s loaded-scope disclosure. */
  totalRowCount?: number;
  /** HEL-1326 design.md D6 — the metric value over the FULL filtered set returned with the last
   *  page-0 rows response (`undefined` = none provided); read only by a metric panel under a
   *  server-applied filter, and never when a client-side cross-filter narrows the loaded rows. */
  filteredMetric?: FilteredMetric | null;
  /** HEL-1027 skeptic-final-3.md CR1 (cycle 4) — the caller's ALREADY-resolved
   *  `useOutputMeta(outputId)` result (e.g. `PanelCardBody`'s own, which `usePanelSortFilter`
   *  also seeds from), reused here instead of `OutputPanelContent` performing its own
   *  independent fetch. `undefined` (the default — distinct from `null`, which means "a caller
   *  supplied one but it hasn't resolved yet") preserves this component's ORIGINAL behavior
   *  exactly: `OutputPanelContent` falls back to its own `useOutputMeta(outputId)` call, as it
   *  always has — `PanelFullscreenOverlay` and `PanelDetailModal` don't pass this prop, so they
   *  are completely unaffected by this change. */
  /** HEL-1190 design.md D9 — widened to also accept `PublicOutputMeta`, the public/anonymous-safe
   *  metadata shape `usePublicPanelData` supplies on the public render path. Its `ownerId` is
   *  always the literal `null` that type declares, which is what makes `TableRenderer`'s
   *  `canWrite` structurally false there regardless of the viewing session's identity — a
   *  prop-shape decision at the call site, never a cast. */
  output?: Output | PublicOutputMeta | null;
  /** Paired with `output` above — the caller's own `useOutputMeta(outputId)` `isLoading` flag.
   *  Ignored when `output` is `undefined` (own-fetch mode). */
  outputMetaLoading?: boolean;
  /** HEL-1191 design.md D3/D9b — REQUIRED so an omitting caller is a type error: how the active
   *  cross-filter applies to THIS panel, decided ONCE by the caller that owns the Output. The
   *  client-side loaded-rows filter below runs only for `"client-fallback"`; on `"server"` the
   *  rows already arrive narrowed, and on `"none"` the filter doesn't touch this panel (also the
   *  public viewer, where no cross-filter can exist). */
  crossFilterMode: CrossFilterMode;
  /** HEL-1275 design.md D3 — true when the caller's built viewer-control filter ops are non-empty
   *  (the SAME ops it sends with the row fetch); hides a metric panel's unfiltered comparison. */
  viewerFilterActive?: boolean;
  /** HEL-1275 design.md D4 — set only by the public viewer; absent → the authenticated history
   *  route keyed by the Output id. */
  historySource?: HistorySource;
}

export function PanelContent({
  panel,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  errorKind,
  onRetry,
  retrying,
  retryVariant,
  noData,
  neverMaterialized,
  onGoToPipeline,
  appearance,
  paginationRows,
  paginationIsLoadingMore,
  onLoadMore,
  rowsTruncated,
  compact,
  onDataPointSelect,
  onSortChange,
  onFilterChange,
  totalRowCount,
  filteredMetric,
  output,
  outputMetaLoading,
  crossFilterMode,
  viewerFilterActive = false,
  historySource,
}: PanelContentProps) {
  if (isLoading) {
    // HEL-528 design.md D6/D7 — a shape-matched skeleton, not the accent
    // spinner: this is the panel's INITIAL structural load (see
    // `Skeleton.tsx`'s division comment), not a short in-place refresh.
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-content panel-content--state panel-content--error" role="alert">
        {/* announced={false} — this wrapper already carries role="alert";
         *  InlineError's own role would double-announce it. */}
        <InlineError
          error={error}
          variant="banner"
          kind={errorKind ?? "error"}
          onRetry={onRetry}
          retrying={retrying}
          retryVariant={retryVariant}
          announced={false}
        />
      </div>
    );
  }

  if (noData && neverMaterialized) {
    // HEL-946 Bug C(2): this node has never had a successful pipeline run
    // since the Output was added — an ACTIONABLE state, distinct from a
    // node that ran and legitimately returned zero rows (handled by the
    // plain "No data available" branch below).
    return (
      <div className="panel-content panel-content--state" role="status">
        <span className="panel-content__state-label">Not run yet</span>
        <p className="panel-content__state-detail">
          This panel&rsquo;s output hasn&rsquo;t been included in a saved pipeline run yet.
        </p>
        {onGoToPipeline && (
          <button
            type="button"
            className="ui-modal-btn ui-modal-btn--secondary"
            onClick={onGoToPipeline}
          >
            Run pipeline
          </button>
        )}
      </div>
    );
  }

  if (noData) {
    return (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">No data available</span>
      </div>
    );
  }

  // Dispatcher: narrow on the discriminator and pick the renderer.
  if (isOutputPanel(panel)) {
    return (
      <OutputPanelContent
        panelId={panel.id}
        rawRows={rawRows}
        headers={headers}
        appearance={appearance ?? panel.appearance}
        paginationRows={paginationRows}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
        rowsTruncated={rowsTruncated}
        compact={compact}
        outputId={panel.config.outputId}
        onDataPointSelect={onDataPointSelect}
        onSortChange={onSortChange}
        onFilterChange={onFilterChange}
        totalRowCount={totalRowCount}
        filteredMetric={filteredMetric}
        output={output}
        isLoading={outputMetaLoading}
        crossFilterMode={crossFilterMode}
        viewerFilterActive={viewerFilterActive}
        historySource={historySource}
      />
    );
  }
  if (isTextPanel(panel)) return <TextRenderer data={data} content={panel.config.content} />;
  if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;
  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;
  if (isFormPanel(panel)) {
    // HEL-1085 design.md D1: dispatches to `FormRenderer`, which renders the
    // "Form not configured" placeholder itself for an empty field list. The
    // if-chain dispatcher is NOT typecheck-protected (C4), so this branch has
    // to be enumerated by hand — proven by mutation (`PanelContent.test.tsx`).
    return <FormRenderer panel={panel} />;
  }

  // Exhaustiveness fallback — this WAS unreachable when the union covered
  // only output/text/markdown/image/divider; it is reachable again the
  // moment a new kind is added without its own branch above (HEL-1083 D10 —
  // this if-chain is not typecheck-protected, unlike an exhaustive switch).
  return <MetricRenderer data={data} />;
}
