// Live preview pane for `OutputEditorSheet.tsx` (task 5.5/5.8). Applies the
// in-progress (possibly unsaved) Output config CLIENT-SIDE over the raw rows
// returned by the preview endpoint (design.md decision 6a -- neither preview
// endpoint applies Output config server-side), then renders through the same
// panel renderers a real dashboard panel uses (`ChartRenderer`/
// `MetricRenderer`) so a saved Output eventually renders identically once
// task 4.2's Output->Panel-config adapter exists.
//
// HEL-629 (task 5.8): `ChartRenderer` -> `ChartPanel` already renders its
// ECharts option with `notMerge={true}` (see `ChartPanel.tsx`'s own comment
// citing this exact pie<->cartesian crash class) -- reusing it here, rather
// than re-implementing chart rendering, means the crash is structurally
// already prevented. Probe-confirmed (not just inferred from the comment):
// switching this pane's Chart type control between "Pie" and "Bar"/"Line"
// against a live preview with real rows renders without throwing --
// verified live during this cycle, no separate forced-remount hack needed.

import { useMemo } from "react";

import type { ChartType } from "../../../../utils/chartAppearance";
import { defaultChartAppearance, defaultPanelAppearance } from "../../../../theme/appearance";
import { computeAggregate, groupAndAggregate } from "../../../../utils/aggregate";
import { ChartRenderer } from "../../../panels/ui/renderers/ChartRenderer";
import { MetricRenderer } from "../../../panels/ui/renderers/MetricRenderer";
import type { MappedPanelData, ChartTypeOptionsMap } from "../../../panels/types/panel";
import type { RunResult } from "../../types/output";
import { isAggFn, isMetricFormat, type MetricFormat } from "./outputConfigTypes";

interface OutputPreviewPaneProps {
  kind: string;
  rows: RunResult | undefined;
  loading: boolean;
  // Chart
  chartType?: ChartType;
  chartFieldMapping?: Record<string, string>;
  chartGroupBy?: string;
  chartAggFn?: string;
  chartYField?: string;
  chartOptions?: ChartTypeOptionsMap | null;
  chartAnnotation?: string | null;
  // Table
  tableColumns?: string[];
  // Metric
  metricField?: string;
  metricAggFn?: string;
  metricLabel?: string;
  metricUnit?: string;
  metricFormat?: string;
  // Markdown
  markdownContent?: string;
}

function rowsToRawRows(rows: Record<string, unknown>[]): {
  headers: string[];
  rawRows: string[][];
} {
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const rawRows = rows.map((row) => headers.map((h) => String(row[h] ?? "")));
  return { headers, rawRows };
}

export function OutputPreviewPane({
  kind,
  rows,
  loading,
  chartType = "line",
  chartFieldMapping,
  chartGroupBy,
  chartAggFn,
  chartYField,
  chartOptions,
  chartAnnotation,
  tableColumns,
  metricField,
  metricAggFn,
  metricLabel,
  metricUnit,
  metricFormat,
  markdownContent,
}: OutputPreviewPaneProps) {
  const metricFormatValue: MetricFormat | null = isMetricFormat(metricFormat) ? metricFormat : null;
  const rawRowData = useMemo(() => rows?.rows ?? [], [rows]);

  const chartAggregate = useMemo(() => {
    if (kind !== "chart" || chartType === "scatter") return null;
    if (!chartGroupBy || !chartYField || !chartAggFn || !isAggFn(chartAggFn)) return null;
    return groupAndAggregate(rawRowData, chartGroupBy, chartAggFn, chartYField);
  }, [kind, chartType, chartGroupBy, chartYField, chartAggFn, rawRowData]);

  if (loading && rawRowData.length === 0) {
    return <p className="output-editor-sheet__field-hint">Loading preview…</p>;
  }
  if (rawRowData.length === 0) {
    return <p className="output-editor-sheet__field-hint">No preview rows yet.</p>;
  }

  if (kind === "chart") {
    const { headers, rawRows } = rowsToRawRows(rawRowData);
    return (
      <div className="output-preview-pane__chart">
        {/* HEL-629 remount key: forces ChartPanel to re-mount its internal
            ECharts instance across a cartesian<->pie switch, belt-and-braces
            alongside `notMerge` (see file doc comment). */}
        <ChartRenderer
          key={chartType}
          appearance={{
            ...defaultPanelAppearance,
            chart: { ...defaultChartAppearance, chartType },
          }}
          rawRows={rawRows}
          headers={headers}
          fieldMapping={chartFieldMapping}
          chartAggregate={chartAggregate}
          chartOptions={chartOptions}
          annotation={chartAnnotation}
          compact
        />
      </div>
    );
  }

  if (kind === "metric") {
    const first = rawRowData;
    const value =
      metricField && metricAggFn && isAggFn(metricAggFn)
        ? String(computeAggregate(first, metricField, metricAggFn) ?? "")
        : metricField
          ? String(first[0]?.[metricField] ?? "")
          : "";
    const data: MappedPanelData = {
      value,
      label: metricLabel ?? "",
      unit: metricUnit ?? "",
    };
    return <MetricRenderer data={data} format={metricFormatValue} />;
  }

  if (kind === "markdown") {
    return (
      <div className="output-editor-sheet__data-section">
        <pre className="output-editor-sheet__field-hint output-preview-pane__markdown">
          {markdownContent || "(empty)"}
        </pre>
      </div>
    );
  }

  // table / collection / timeline — a simple read-only preview table. Not
  // wired through `TableRenderer` (that component persists column-resize
  // PATCHes against a `panelId`, which an Output sheet has no matching
  // panel for -- see design.md's "Output sheet never a Panel" framing).
  const { headers, rawRows } = rowsToRawRows(rawRowData);
  const visibleHeaders =
    tableColumns && tableColumns.length > 0
      ? headers.filter((h) => tableColumns.includes(h))
      : headers;
  return (
    <div className="output-editor-sheet__data-section output-preview-pane__table-section">
      <table className="output-preview-table">
        <thead>
          <tr>
            {visibleHeaders.map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rawRows.slice(0, 20).map((row, i) => (
            <tr key={i}>
              {visibleHeaders.map((h) => (
                <td key={h}>{row[headers.indexOf(h)]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
