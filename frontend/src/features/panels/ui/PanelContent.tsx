import type { ReactNode } from "react";

import "./PanelContent.css";
import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type { MappedPanelData, Panel, PanelAppearance } from "../types/panel";
import type { GroupedAggregate } from "../../../utils/aggregate";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
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
import {
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { computeAggregate } from "../../../utils/aggregate";
import {
  filterRecordRowsByDimension,
  filterRowsByDimension,
  isPanelFilterableByDimension,
} from "../../../utils/crossFilterRows";
import { ChartRenderer } from "./renderers/ChartRenderer";
import { CollectionRenderer } from "./renderers/CollectionRenderer";
import { DividerRenderer } from "./renderers/DividerRenderer";
import { FormRenderer } from "./renderers/FormRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { LoadedScopeDisclosure } from "./renderers/LoadedScopeDisclosure";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
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
  /** HEL-292: precomputed chart groupBy aggregate, chart panels only. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-301: forwarded to `ChartRenderer` only — see `ChartPanel`'s
   *  `compact` prop. */
  compact?: boolean;
  /** HEL-572: forwarded to `ChartRenderer` (chart-kind output panels only)
   *  — see `ChartPanel`'s `onDataPointSelect` prop. */
  onDataPointSelect?: (selection: ChartClickSelection) => void;
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
  chartAggregate,
  compact,
  outputId,
  onDataPointSelect,
}: {
  panelId: string;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  appearance: PanelAppearance;
  paginationRows?: Record<string, unknown>[] | null;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  rowsTruncated?: boolean;
  chartAggregate?: GroupedAggregate | null;
  compact?: boolean;
  outputId: string;
  onDataPointSelect?: (selection: ChartClickSelection) => void;
}) {
  const { output, isLoading } = useOutputMeta(outputId);
  // evaluation-1.md CR1/CR2 (cycle 2) — applying the cross-filter HERE,
  // rather than upstream at PanelCard/MobileStackPanelBody, is what makes
  // this genuinely a SINGLE call site: this `useOutputMeta` fetch is the
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
  const crossFilter = useAppSelector((state) => state.panels.crossFilter);

  if (isLoading || !output) {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }

  const isEligibleTarget =
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

  const kind = output.kind;
  let content: ReactNode;

  if (kind === "chart") {
    const cfg = readChartConfig(output.config);
    content = (
      <ChartRenderer
        appearance={appearance}
        rawRows={filteredRawRows}
        headers={headers}
        fieldMapping={cfg.fieldMapping}
        chartAggregate={chartAggregate}
        chartOptions={cfg.chartOptions}
        annotation={cfg.annotation ?? null}
        compact={compact}
        onDataPointSelect={onDataPointSelect}
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
      />
    );
  } else if (kind === "metric") {
    const cfg = readMetricConfig(output.config);
    const firstRow =
      filteredRawRows && headers && filteredRawRows.length > 0
        ? Object.fromEntries(headers.map((h, i) => [h, filteredRawRows[0][i]]))
        : null;
    const valueColumn = Object.values(cfg.fieldMapping)[0];
    const rowsAsRecords =
      filteredRawRows && headers
        ? filteredRawRows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
        : [];
    const value =
      valueColumn && cfg.aggregation?.agg
        ? String(computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg) ?? "")
        : valueColumn && firstRow
          ? String(firstRow[valueColumn] ?? "")
          : "";
    const data: MappedPanelData = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" };
    content = <MetricRenderer data={data} format={cfg.format} />;
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
  chartAggregate,
  compact,
  onDataPointSelect,
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
        chartAggregate={chartAggregate}
        compact={compact}
        outputId={panel.config.outputId}
        onDataPointSelect={onDataPointSelect}
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
