import type { ReactNode } from "react";

import { PanelBodySkeleton } from "./PanelBodySkeleton";
import type { PanelAppearance } from "../types/panel";
import type { FilteredMetric } from "../../pipelines/services/outputService";
import type { Output, PublicOutputMeta } from "../../pipelines/types/output";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import type { SortDirection } from "../../../shared/ui/useSortedRows";
import type { TableColumnFilters } from "../../pipelines/ui/outputEditor/outputConfigTypes";
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
import { LoadedScopeDisclosure } from "./renderers/LoadedScopeDisclosure";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricOutputPanel } from "./MetricOutputPanel";
import type { HistorySource } from "../history/useOutputHistory";
import { TableRenderer } from "./renderers/TableRenderer";
import { TimelineRenderer } from "./renderers/TimelineRenderer";

/** Dispatches on an output-kind panel's fetched Output `kind`/`config`
 *  (HEL-909 Cycle-1 finding: an `OutputPanel` placement alone does not carry
 *  enough info to render). Non-output panel kinds (text/markdown/image/
 *  divider) are dashboard-native and never reach here. */
export function OutputPanelContent({
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
