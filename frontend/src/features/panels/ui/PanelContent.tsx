import type { ReactNode } from "react";

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
import { useOutputMeta } from "../hooks/useOutputMeta";
import { useAppSelector } from "../../../hooks/reduxHooks";
import type { CrossFilterMode } from "../hooks/useCrossFilterServerOps";
import {
  readCollectionConfig,
  readMarkdownConfig,
  readTableConfig,
  readTimelineConfig,
} from "../../pipelines/ui/outputEditor/outputConfigTypes";
import {
  filterRecordRowsByDimension,
  filterRowsByDimension,
  isPanelFilterableByDimension,
} from "../../../utils/crossFilterRows";
import { ChartOutputPanel } from "./ChartOutputPanel";
import { chartTruncationNote, chartTruncationNoteShort } from "./chartTruncationNote";
import { CollectionRenderer } from "./renderers/CollectionRenderer";
import { DividerRenderer } from "./renderers/DividerRenderer";
import { FormRenderer } from "./renderers/FormRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { LoadedScopeDisclosure } from "./renderers/LoadedScopeDisclosure";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
import { MetricOutputPanel } from "./MetricOutputPanel";
import type { HistorySource } from "../history/useOutputHistory";
import { TableRenderer } from "./renderers/TableRenderer";
import { TextRenderer } from "./renderers/TextRenderer";
import { TimelineRenderer } from "./renderers/TimelineRenderer";

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

/** Dispatches on an output-kind panel's fetched Output `kind`/`config`
 *  (HEL-909 Cycle-1 finding: an `OutputPanel` placement alone does not carry
 *  enough info to render). Non-output panel kinds (text/markdown/image/
 *  divider) are dashboard-native and never reach here. */
function OutputPanelContent({
  panelId,
  rawRows,
  headers,
  appearance,
  paginationRows,
  paginationIsLoadingMore,
  onLoadMore,
  rowsTruncated,
  compact,
  outputId,
  onDataPointSelect,
  onSortChange,
  onFilterChange,
  totalRowCount,
  filteredMetric,
  output: outputProp,
  isLoading: isLoadingProp,
  crossFilterMode,
  viewerFilterActive,
  historySource,
}: {
  panelId: string;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  appearance: PanelAppearance;
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  rowsTruncated?: boolean;
  compact?: boolean;
  outputId: string;
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  onSortChange?: (column: string, direction: SortDirection | null) => void;
  onFilterChange?: (filters: TableColumnFilters) => void;
  totalRowCount?: number;
  filteredMetric?: FilteredMetric | null;
  output?: Output | PublicOutputMeta | null;
  isLoading?: boolean;
  crossFilterMode: CrossFilterMode;
  viewerFilterActive: boolean;
  historySource?: HistorySource;
}) {
  // evaluation-1.md CR1/CR2 (cycle 2) — applying the cross-filter HERE,
  // rather than upstream at PanelCard/MobileStackPanelBody, is what makes
  // this genuinely a SINGLE call site: this component's resolved `output` is the
  // SAME ONE this component already needs (unconditionally) to pick a
  // renderer for `output.kind` — no NEW fetch, and therefore no fetch-timing
  // race between two INDEPENDENT `useOutputMeta` instances resolving at
  // different times. That race is exactly what the cycle-1 design (applying
  // the filter in the caller, using the caller's OWN separately-fetched
  // `output`) introduced for `MobileStackPanelBody` specifically — it had no
  // pre-existing `useOutputMeta` call before this ticket, so adding one there
  // for cross-filtering purposes created a second, independent fetch of the
  // same Output that could resolve AFTER this component's own, producing a
  // live, reproducible transient window where a Table-kind sibling panel's
  // rows rendered UNFILTERED right after a desktop-grid/mobile-stack
  // breakpoint remount (probe-confirmed: `page.evaluate` reading rendered
  // `<td>` text immediately after `setViewportSize` at the 768px breakpoint
  // showed all 4 unfiltered rows; the same check after a 300ms settle showed
  // the correct 2 filtered rows — the transient window closes as soon as the
  // slower of the two fetches resolves). Moving filtering to this ALREADY-
  // resolving-exactly-once fetch closes that window entirely.
  //
  // HEL-1027 skeptic-final-3.md CR1 (cycle 4) — this component's own fetch is now, in turn,
  // SKIPPED entirely whenever a caller supplies `output` (`outputProp !== undefined`;
  // `PanelCardBody` is the one caller that does, via its own single `useOutputMeta(outputId)`
  // call, so the SAME fetch that seeds `usePanelSortFilter`'s persisted-default correction also
  // drives this component's kind-dispatch/cross-filter render — the two can no longer disagree,
  // by construction, exactly like the invariant this comment already describes above).
  // `PanelFullscreenOverlay`/`PanelDetailModal` don't pass `output`, so they are unaffected:
  // `outputProp` is `undefined` there, `hasExternalOutput` is `false`, and this falls through to
  // exactly the own-fetch behavior this component has always had.
  const hasExternalOutput = outputProp !== undefined;
  const ownFetch = useOutputMeta(hasExternalOutput ? null : outputId);
  const output = hasExternalOutput ? outputProp : ownFetch.output;
  const isLoading = hasExternalOutput ? (isLoadingProp ?? false) : ownFetch.isLoading;
  const crossFilter = useAppSelector((state) => state.panels.crossFilter);

  if (isLoading || !output) {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }

  // HEL-1191 design.md D3 — the client-side loaded-rows filter is now ONLY the fallback for a
  // panel whose contract can't take the server `eq`; never applied on top of a server-narrowed set.
  const isEligibleTarget =
    crossFilterMode === "client-fallback" &&
    crossFilter !== null &&
    crossFilter.panelId !== panelId &&
    isPanelFilterableByDimension(
      output.kind,
      output.config,
      headers ?? null,
      crossFilter.dimension,
    );

  const filteredRawRows =
    isEligibleTarget && rawRows && headers
      ? filterRowsByDimension(rawRows, headers, crossFilter!.dimension, crossFilter!.value)
      : rawRows;
  const filteredPaginationRows =
    isEligibleTarget && paginationRows
      ? filterRecordRowsByDimension(paginationRows, crossFilter!.dimension, crossFilter!.value)
      : paginationRows;
  // Reference inequality — see `useCrossFilteredPanelData`'s identical
  // convention — distinguishes "actually narrowed" from a safe no-op
  // (`isPanelFilterableByDimension` passed, but the dimension still isn't
  // literally present in this fetch's OWN `headers`, a drift case
  // `filterRowsByDimension`'s own no-op guard protects against).
  const isCrossFiltered = isEligibleTarget && filteredRawRows !== rawRows;
  const crossFilterLoadedRowCount = rawRows?.length ?? 0;

  const truncationArgs = {
    rowsTruncated,
    totalRowCount,
    loadedCount: crossFilterLoadedRowCount,
    narrowed: viewerFilterActive || crossFilterMode === "server",
  };

  const kind = output.kind;
  let content: ReactNode;

  if (kind === "chart") {
    content = (
      <ChartOutputPanel
        panelId={panelId}
        outputId={outputId}
        pipelineId={"pipelineId" in output ? output.pipelineId : undefined}
        config={output.config}
        appearance={appearance}
        rawRows={filteredRawRows}
        headers={headers}
        // HEL-1351 design D2 — the cross-filter-narrowed record rows an aggregated Output groups.
        records={filteredPaginationRows}
        compact={compact}
        onDataPointSelect={onDataPointSelect}
        // HEL-1277 design D9 — a viewer control filter, or a cross-filter narrowing this panel,
        // hides the overlay (it compares against the Output's unfiltered rows).
        filterActive={viewerFilterActive || crossFilterMode === "server" || isCrossFiltered}
        rowsTruncated={rowsTruncated}
        historySource={historySource}
        // HEL-1358 design D1/D2 — fails closed; the count is the PRE-cross-filter loaded count and
        // a server-narrowed total reads "matching rows".
        truncationNote={chartTruncationNote(truncationArgs)}
        truncationNoteShort={chartTruncationNoteShort(truncationArgs)}
      />
    );
  } else if (kind === "table") {
    const cfg = readTableConfig(output.config);
    content = (
      <TableRenderer
        outputId={outputId}
        ownerId={output.ownerId}
        rawRows={filteredRawRows}
        headers={headers}
        paginationRows={filteredPaginationRows}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
        rowsTruncated={rowsTruncated ?? false}
        columnOrder={cfg.columnOrder}
        columnSort={cfg.columnSort}
        columnFilters={cfg.columnFilters}
        columnFormats={cfg.columnFormats}
        pinnedColumns={cfg.pinnedColumns}
        // HEL-1027 design.md D2/D3 (task 4.5) — this Output's OWN declared schema (already
        // resolved by this component's existing `useOutputMeta` call above, no new fetch), so
        // `TableRenderer` can gate each column's sort/filter control on its Structured/Content
        // category without inferring anything from row data.
        schema={output.schema}
        onSortChange={onSortChange}
        onFilterChange={onFilterChange}
        totalRowCount={totalRowCount}
      />
    );
  } else if (kind === "metric") {
    content = (
      <MetricOutputPanel
        panelId={panelId}
        outputId={outputId}
        pipelineId={"pipelineId" in output ? output.pipelineId : undefined}
        config={output.config}
        rawRows={filteredRawRows}
        headers={headers}
        // HEL-1408 design D6 -- typed records so a client `count` excludes null like the server.
        records={filteredPaginationRows}
        // HEL-1275 design.md D3 — an applied viewer control filter, or a cross-filter narrowing this
        // panel (server `eq`, or the client-side loaded-rows fallback), hides the unfiltered delta.
        filterActive={viewerFilterActive || crossFilterMode === "server" || isCrossFiltered}
        // HEL-1326 design.md D5/D6 — a client-side cross-filter narrows only the LOADED rows, which
        // the server's filtered value cannot reflect, so that state keeps the loaded-rows value (the
        // HEL-588 disclosure below labels it); otherwise the server's full-filtered-set value wins.
        filteredMetric={isCrossFiltered ? undefined : filteredMetric}
        historySource={historySource}
      />
    );
  } else if (kind === "markdown") {
    const cfg = readMarkdownConfig(output.config);
    content = <MarkdownRenderer content={cfg.content} />;
  } else if (kind === "collection") {
    const cfg = readCollectionConfig(output.config);
    content = (
      <CollectionRenderer
        fieldMapping={cfg.fieldMapping}
        layout={cfg.layout}
        format={cfg.format}
        rawRows={filteredRawRows}
        headers={headers}
      />
    );
  } else if (kind === "timeline") {
    const cfg = readTimelineConfig(output.config);
    content = (
      <TimelineRenderer
        fieldMapping={cfg.fieldMapping}
        sort={cfg.sort}
        rawRows={filteredRawRows}
        headers={headers}
      />
    );
  } else {
    content = (
      <div className="panel-content panel-content--state">
        <span className="panel-content__state-label">Unsupported output kind</span>
      </div>
    );
  }

  return (
    <>
      {content}
      {/* HEL-588 design.md D7 — reuses `LoadedScopeDisclosure` (HEL-448/451)
          rather than a new component: a cross-filtered, non-origin panel
          whose own loaded rows are truncated must say so, not imply the
          filtered result is complete (spec.md). `filtering: true` +
          matchCount/loadedCount reuses the SAME "N of M loaded rows match."
          wording the table quick-filter already uses — the shape fits
          exactly, since a cross-filter is, mechanically, one more row
          filter over the same loaded set. Deliberately wired HERE (every
          output kind) rather than inside `TableRenderer` alone, so a table
          panel that is ALSO truncated shows both its own column-filter
          disclosure and this cross-filter-scoped one when both apply. */}
      {isCrossFiltered && rowsTruncated && (
        <LoadedScopeDisclosure
          rowsTruncated
          filtering
          matchCount={filteredRawRows?.length ?? 0}
          loadedCount={crossFilterLoadedRowCount ?? 0}
        />
      )}
    </>
  );
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
