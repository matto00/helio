// HEL-1632 (design.md D6): one Output rendered from in-memory records with the renderers a dashboard panel uses. Pure
// props in, no history, no fetch. Chart and metric inputs come from the shared `outputRenderInputs` functions, so for the
// same records and config this draws what the saved panel draws; a metric's headline is always the rows' value.

import { useMemo } from "react";

import { defaultPanelAppearance } from "../../../../theme/appearance";
import {
  chartPlotOverlay,
  chartRenderInputs,
  metricLoadedValue,
  recordsToPanelRows,
} from "../../../panels/ui/outputRenderInputs";
import type { OutputHistory } from "../../../panels/history/outputHistoryService";
import { selectDraftMetricComparison } from "../../../panels/history/metricHistoryView";
import { ChartRenderer } from "../../../panels/ui/renderers/ChartRenderer";
import { CollectionRenderer } from "../../../panels/ui/renderers/CollectionRenderer";
import { InsightNotRenderedState } from "../../../panels/ui/InsightNotRenderedState";
import { MarkdownRenderer } from "../../../panels/ui/renderers/MarkdownRenderer";
import { MetricRenderer } from "../../../panels/ui/renderers/MetricRenderer";
import { TimelineRenderer } from "../../../panels/ui/renderers/TimelineRenderer";
import type { OutputSchemaField } from "../../types/output";
import {
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "../outputEditor/outputConfigTypes";

type Records = Record<string, unknown>[];

export interface LiveOutputRenderProps {
  kind: string;
  config: Record<string, unknown>;
  schema: OutputSchemaField[] | null | undefined;
  records: Records;
  /** The Output's history, for the compare overlay and the metric comparison (HEL-1705); `null` draws neither. */
  history?: OutputHistory | null;
  /** More rows exist than `records` holds (a truncated sample or rows line): the overlay compares against the Output's
   *  complete set, so it is then hidden, exactly as on a dashboard. Fails closed when omitted. */
  rowsTruncated?: boolean;
  /** The column order of `records` (HEL-1705); absent, the first record's key order. */
  columns?: readonly string[];
}

export function LiveOutputRender({
  kind,
  config,
  schema,
  records,
  history = null,
  rowsTruncated = true,
  columns,
}: LiveOutputRenderProps) {
  const { headers, rawRows } = useMemo(
    () => recordsToPanelRows(records, columns),
    [records, columns],
  );
  const chart = useMemo(
    () =>
      kind === "chart"
        ? chartRenderInputs({ config, schema, appearance: defaultPanelAppearance, records })
        : null,
    [kind, config, schema, records],
  );
  // The same overlay and comparison selectors a dashboard panel uses, over the draft rows (HEL-1705 D4).
  const overlay = useMemo(
    () =>
      chart === null
        ? null
        : chartPlotOverlay({
            history,
            config,
            aggregationSpec: chart.aggregationSpec,
            chartAggregate: chart.chartAggregate,
            ctx: { filterActive: false, rowsTruncated, rawRows, headers },
          }),
    [chart, history, config, rowsTruncated, rawRows, headers],
  );
  const metricValue = useMemo(
    () => (kind === "metric" ? metricLoadedValue(config, records, rawRows, headers) : ""),
    [kind, config, records, rawRows, headers],
  );
  const comparison = useMemo(() => {
    if (kind !== "metric") return null;
    const draftValue = metricValue.trim() === "" ? Number.NaN : Number(metricValue);
    return selectDraftMetricComparison(
      history,
      config,
      Number.isFinite(draftValue) ? draftValue : null,
    );
  }, [kind, history, config, metricValue]);

  if (kind === "chart" && chart) {
    return (
      <ChartRenderer
        appearance={chart.appearance}
        rawRows={rawRows}
        headers={headers}
        fieldMapping={chart.fieldMapping}
        chartAggregate={chart.chartAggregate}
        aggregationSpec={chart.aggregationSpec}
        chartOptions={chart.chartOptions}
        annotation={chart.annotation}
        overlay={overlay}
        referenceMarks={chart.referenceMarks}
        fieldTypes={chart.fieldTypes}
        compact
        noAnimation
      />
    );
  }
  if (kind === "metric") {
    const cfg = readMetricConfig(config);
    return (
      <MetricRenderer
        data={{
          value: metricValue,
          label: cfg.label ?? "",
          unit: cfg.unit ?? "",
        }}
        format={cfg.format}
        comparison={comparison}
        conditionalFormats={cfg.conditionalFormats}
      />
    );
  }
  if (kind === "markdown") {
    return <MarkdownRenderer content={readMarkdownConfig(config).content} />;
  }
  if (kind === "collection") {
    const cfg = readCollectionConfig(config);
    return (
      <CollectionRenderer
        fieldMapping={cfg.fieldMapping}
        layout={cfg.layout}
        format={cfg.format}
        rawRows={rawRows}
        headers={headers}
        conditionalFormats={cfg.conditionalFormats}
      />
    );
  }
  if (kind === "timeline") {
    const cfg = readTimelineConfig(config);
    return (
      <TimelineRenderer
        fieldMapping={cfg.fieldMapping}
        sort={cfg.sort}
        rawRows={rawRows}
        headers={headers}
      />
    );
  }
  if (kind === "table") {
    return <LiveTable config={config} headers={headers} rawRows={rawRows} />;
  }
  if (kind === "insight") return <InsightNotRenderedState />;
  return <p className="live-output__hint">This Output kind has no live render.</p>;
}

/** A read-only table (no `TableRenderer`: it PATCHes column widths against a panel). A configured column order wins
 *  (columns it does not name follow in the live, schema order); every column shows. */
function LiveTable({
  config,
  headers,
  rawRows,
}: {
  config: Record<string, unknown>;
  headers: string[] | null;
  rawRows: string[][] | null;
}) {
  const cfg = readTableConfig(config);
  const columns = headers ?? [];
  const configured = cfg.columnOrder ?? [];
  const order = configured.length
    ? [
        ...configured.filter((c) => columns.includes(c)),
        ...columns.filter((c) => !configured.includes(c)),
      ]
    : columns;
  return (
    <div className="live-output__table-scroll">
      <table className="output-preview-table">
        <thead>
          <tr>
            {order.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rawRows ?? []).slice(0, 50).map((row, i) => (
            <tr key={i}>
              {order.map((h) => (
                <td key={h}>{row[columns.indexOf(h)]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
