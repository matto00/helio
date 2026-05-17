import "./PanelContent.css";
import type { MappedPanelData, Panel, PanelAppearance } from "../types/panel";
import {
  isChartPanel,
  isDividerPanel,
  isImagePanel,
  isMarkdownPanel,
  isMetricPanel,
  isTablePanel,
  isTextPanel,
} from "../state/panelNarrowing";
import { ChartRenderer } from "./renderers/ChartRenderer";
import { DividerRenderer } from "./renderers/DividerRenderer";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MetricRenderer } from "./renderers/MetricRenderer";
import { TableRenderer } from "./renderers/TableRenderer";
import { TextRenderer } from "./renderers/TextRenderer";

export interface PanelContentProps {
  panel: Panel;
  data?: MappedPanelData | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  isLoading?: boolean;
  error?: string | null;
  noData?: boolean;
  /** Optional appearance override (defaults to `panel.appearance`). */
  appearance?: PanelAppearance;
  /** Rows from the paginated execute endpoint for table panels. */
  paginationRows?: Record<string, unknown>[] | null;
  paginationHasMore?: boolean;
  paginationIsLoadingMore?: boolean;
  onLoadMore?: () => void;
}

export function PanelContent({
  panel,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  noData,
  appearance,
  paginationRows,
  paginationHasMore,
  paginationIsLoadingMore,
  onLoadMore,
}: PanelContentProps) {
  if (isLoading) {
    return (
      <div className="panel-content panel-content--state" aria-label="Loading data">
        <span className="panel-content__spinner" aria-hidden="true" />
        <span className="panel-content__state-label">Loading...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel-content panel-content--state panel-content--error" role="alert">
        <span className="panel-content__state-label">{error}</span>
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
      />
    );
  }
  if (isTablePanel(panel)) {
    return (
      <TableRenderer
        rawRows={rawRows}
        headers={headers}
        paginationRows={paginationRows}
        paginationHasMore={paginationHasMore}
        paginationIsLoadingMore={paginationIsLoadingMore}
        onLoadMore={onLoadMore}
      />
    );
  }
  if (isTextPanel(panel)) return <TextRenderer data={data} content={panel.config.content} />;
  if (isMarkdownPanel(panel)) return <MarkdownRenderer panel={panel} />;
  if (isImagePanel(panel)) return <ImageRenderer panel={panel} />;
  if (isDividerPanel(panel)) return <DividerRenderer panel={panel} />;

  // Exhaustiveness fallback — the union is closed so this is unreachable.
  return <MetricRenderer data={data} />;
}
