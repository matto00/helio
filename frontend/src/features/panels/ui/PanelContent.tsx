import "./PanelContent.css";
import { PanelBodySkeleton } from "./PanelBodySkeleton";
import { InlineError } from "../../../shared/chrome/InlineError";
import type { RequestErrorKind } from "../../../services/classifyRequestError";
import type { MappedPanelData, Panel, PanelAppearance } from "../types/panel";
import type { GroupedAggregate } from "../../../utils/aggregate";
import {
  isChartPanel,
  isCollectionPanel,
  isDividerPanel,
  isImagePanel,
  isMarkdownPanel,
  isMetricPanel,
  isTablePanel,
  isTextPanel,
  isTimelinePanel,
} from "../state/panelNarrowing";
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
  if (isMetricPanel(panel)) return <MetricRenderer data={data} />;
  if (isChartPanel(panel)) {
    return (
      <ChartRenderer
        appearance={appearance ?? panel.appearance}
        rawRows={rawRows}
        headers={headers}
        fieldMapping={panel.config.fieldMapping}
        chartAggregate={chartAggregate}
        chartOptions={panel.config.chartOptions}
        // HEL-323 — literal-wins: the static `config.annotation` takes
        // precedence; otherwise fall back to the bound annotation resolved
        // from the first row (`data.annotation`, the value of
        // `fieldMapping.annotation` computed by `usePanelData`).
        annotation={panel.config.annotation ?? data?.annotation ?? null}
        compact={compact}
      />
    );
  }
  if (isTablePanel(panel)) {
    return (
      <TableRenderer
        panelId={panel.id}
        rawRows={rawRows}
        headers={headers}
        paginationRows={paginationRows}
        paginationHasMore={paginationHasMore}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
        columnWidths={panel.config.columnWidths}
        density={panel.config.density}
        columnOrder={panel.config.columnOrder}
      />
    );
  }
  if (isTextPanel(panel)) return <TextRenderer data={data} content={panel.config.content} />;
  if (isMarkdownPanel(panel)) return <MarkdownRenderer panel={panel} data={data} />;
  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;
  // HEL-247 — collection uses the table fetch path (rawRows/headers): one bound
  // row expands to one metric item.
  if (isCollectionPanel(panel)) {
    return <CollectionRenderer panel={panel} rawRows={rawRows} headers={headers} />;
  }
  // HEL-317 — timeline uses the same table fetch path as collection: one
  // bound row expands to one timeline entry.
  if (isTimelinePanel(panel)) {
    return <TimelineRenderer panel={panel} rawRows={rawRows} headers={headers} />;
  }

  // Exhaustiveness fallback — the union is closed so this is unreachable.
  return <MetricRenderer data={data} />;
}
