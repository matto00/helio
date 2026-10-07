import { DataGrid, StatusChip } from "../../../../shared/ui";
import { formatMetricValue } from "../../../panels/ui/renderers/MetricRenderer";
import { formatCapturePair } from "../../../panels/history/formatCaptureTime";
import type { HistoryPoint } from "../../../panels/history/outputHistoryService";
import type { Output } from "../../types/output";
import { isMetricFormat } from "../outputEditor/outputConfigTypes";
import { triggerSourceLabel } from "../../utils/triggerSourceLabel";

interface HistorySummaryProps {
  output: Output;
  selected: HistoryPoint;
  comparison: HistoryPoint | null;
}

function metricText(point: HistoryPoint | null, output: Output): string | null {
  const value = point?.summary.metric?.value;
  if (value === null || value === undefined) return null;
  const format = isMetricFormat(output.config.format) ? output.config.format : null;
  return formatMetricValue(String(value), format) ?? String(value);
}

const STATS_COLUMNS = [
  { key: "column", header: "Column" },
  { key: "count", header: "Count", align: "right" as const },
  { key: "sum", header: "Sum", align: "right" as const },
  { key: "min", header: "Min", align: "right" as const },
  { key: "max", header: "Max", align: "right" as const },
];

/** HEL-1277 design D4/D5 — the selected point's header and stored summary: capture time, trigger,
 *  row count, the headline metric beside the comparison point's, and the per-column stats. Needs no
 *  payload. */
export function HistorySummary({ output, selected, comparison }: HistorySummaryProps) {
  const labels = formatCapturePair(selected.capturedAt, comparison?.capturedAt ?? null);
  const headline = metricText(selected, output);
  const baseline = metricText(comparison, output);
  const columns = selected.summary.columns ?? {};
  const statsRows = Object.entries(columns).map(([column, s]) => ({
    column,
    count: s.count,
    sum: s.sum,
    min: s.min,
    max: s.max,
  }));
  return (
    <section className="output-history__summary" aria-label="Selected run summary">
      <div className="output-history__point-header">
        <h3 className="output-history__point-time">{labels.selected}</h3>
        <StatusChip intent="neutral">{triggerSourceLabel(selected.triggerSource)}</StatusChip>
        <span className="output-history__muted">
          {selected.rowCount.toLocaleString()} {selected.rowCount === 1 ? "row" : "rows"}
        </span>
      </div>
      {comparison ? (
        <p className="output-history__caption">vs {labels.comparison}</p>
      ) : (
        <p className="output-history__caption">Oldest recorded run: nothing to compare against.</p>
      )}
      {headline !== null && (
        <p className="output-history__metric">
          <span className="output-history__metric-value">{headline}</span>
          {comparison && baseline !== null && (
            <span className="output-history__muted">
              {" "}
              vs {labels.comparison}: {baseline}
            </span>
          )}
        </p>
      )}
      {statsRows.length > 0 && (
        <DataGrid variant="preview" rows={statsRows} columns={STATS_COLUMNS} />
      )}
    </section>
  );
}
