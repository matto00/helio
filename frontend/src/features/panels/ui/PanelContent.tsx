import "./PanelContent.css";
import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type { MappedPanelData, Panel, PanelAppearance } from "../types/panel";
import type { GroupedAggregate } from "../../../utils/aggregate";
import {
  isDividerPanel,
  isImagePanel,
  isMarkdownPanel,
  isOutputPanel,
  isTextPanel,
} from "../state/panelNarrowing";
import { useOutputMeta } from "../hooks/useOutputMeta";
import {
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "../../pipelines/ui/outputEditor/outputConfigTypes";
import { computeAggregate } from "../../../utils/aggregate";
import { ChartRenderer } from "./renderers/ChartRenderer";
import { CollectionRenderer } from "./renderers/CollectionRenderer";
import { DividerRenderer } from "./renderers/DividerRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
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
  /** Optional appearance override (defaults to `panel.appearance`). */
  appearance?: PanelAppearance;
  /** Rows from the paginated execute endpoint for table panels. */
  paginationRows?: Record<string, unknown>[] | null;
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  /** HEL-292: precomputed chart groupBy aggregate, chart panels only. */
  chartAggregate?: GroupedAggregate | null;
  /** HEL-301: forwarded to `ChartRenderer` only — see `ChartPanel`'s
   *  `compact` prop. */
  compact?: boolean;
}

/** Dispatches on an output-kind panel's fetched Output `kind`/`config`
 *  (HEL-909 Cycle-1 finding: an `OutputPanel` placement alone does not carry
 *  enough info to render). Non-output panel kinds (text/markdown/image/
 *  divider) are dashboard-native and never reach here. */
function OutputPanelContent({
  rawRows,
  headers,
  appearance,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
  chartAggregate,
  compact,
  outputId,
}: {
  rawRows?: string[][] | null;
  headers?: string[] | null;
  appearance: PanelAppearance;
  paginationRows?: Record<string, unknown>[] | null;
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
  chartAggregate?: GroupedAggregate | null;
  compact?: boolean;
  outputId: string;
}) {
  const { output, isLoading } = useOutputMeta(outputId);

  if (isLoading || !output) {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <PanelBodySkeleton />
      </div>
    );
  }

  const kind = output.kind;

  if (kind === "chart") {
    const cfg = readChartConfig(output.config);
    return (
      <ChartRenderer
        appearance={appearance}
        rawRows={rawRows}
        headers={headers}
        fieldMapping={cfg.fieldMapping}
        chartAggregate={chartAggregate}
        chartOptions={cfg.chartOptions}
        annotation={cfg.annotation ?? null}
        compact={compact}
      />
    );
  }

  if (kind === "table") {
    const cfg = readTableConfig(output.config);
    return (
      <TableRenderer
        panelId={outputId}
        rawRows={rawRows}
        headers={headers}
        paginationRows={paginationRows}
        paginationHasMore={paginationHasMore}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
        columnOrder={cfg.columnOrder}
      />
    );
  }

  if (kind === "metric") {
    const cfg = readMetricConfig(output.config);
    const firstRow =
      rawRows && headers && rawRows.length > 0
        ? Object.fromEntries(headers.map((h, i) => [h, rawRows[0][i]]))
        : null;
    const valueColumn = Object.values(cfg.fieldMapping)[0];
    const rowsAsRecords =
      rawRows && headers
        ? rawRows.map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])))
        : [];
    const value =
      valueColumn && cfg.aggregation?.agg
        ? String(computeAggregate(rowsAsRecords, valueColumn, cfg.aggregation.agg) ?? "")
        : valueColumn && firstRow
          ? String(firstRow[valueColumn] ?? "")
          : "";
    const data: MappedPanelData = { value, label: cfg.label ?? "", unit: cfg.unit ?? "" };
    return <MetricRenderer data={data} format={cfg.format} />;
  }

  if (kind === "markdown") {
    const cfg = readMarkdownConfig(output.config);
    return <MarkdownRenderer content={cfg.content} />;
  }

  if (kind === "collection") {
    const cfg = readCollectionConfig(output.config);
    return (
      <CollectionRenderer
        fieldMapping={cfg.fieldMapping}
        layout={cfg.layout}
        format={cfg.format}
        rawRows={rawRows}
        headers={headers}
      />
    );
  }

  if (kind === "timeline") {
    const cfg = readTimelineConfig(output.config);
    return (
      <TimelineRenderer
        fieldMapping={cfg.fieldMapping}
        sort={cfg.sort}
        rawRows={rawRows}
        headers={headers}
      />
    );
  }

  return (
    <div className="panel-content panel-content--state">
      <span className="panel-content__state-label">Unsupported output kind</span>
    </div>
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
  appearance,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
  chartAggregate,
  compact,
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
        rawRows={rawRows}
        headers={headers}
        appearance={appearance ?? panel.appearance}
        paginationRows={paginationRows}
        paginationHasMore={paginationHasMore}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
        chartAggregate={chartAggregate}
        compact={compact}
        outputId={panel.config.outputId}
      />
    );
  }
  if (isTextPanel(panel)) return <TextRenderer data={data} content={panel.config.content} />;
  if (isMarkdownPanel(panel)) return <MarkdownRenderer content={panel.config.content} />;
  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;

  // Exhaustiveness fallback — the union is closed so this is unreachable.
  return <MetricRenderer data={data} />;
}
