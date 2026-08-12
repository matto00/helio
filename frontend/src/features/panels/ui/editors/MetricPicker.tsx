// Bind-to-metric picker (HEL-500/HEL-553 design.md D5/D6). Presentational —
// `BindingEditor`/`useMetricBindingState` own the selection/dirty state.
// Composed into `MetricBindingFields.tsx` for metric panels (resolved fields
// shown read-only) and rendered directly by `BindingEditor.tsx` for chart/
// table panels (no materialization — design.md D6).

import { Select } from "../../../../shared/ui/index";
import type { MetricSummary } from "../../../metrics/types/metric";

function formatMetricFormat(format: MetricSummary["format"]): string {
  const parts: string[] = [];
  if (format.prefix) parts.push(`prefix "${format.prefix}"`);
  if (format.unit) parts.push(`unit ${format.unit}`);
  if (format.suffix) parts.push(`suffix "${format.suffix}"`);
  if (format.decimals !== null && format.decimals !== undefined) {
    parts.push(`${format.decimals} decimals`);
  }
  return parts.length > 0 ? parts.join(", ") : "—";
}

interface MetricPickerProps {
  metrics: MetricSummary[];
  metricsStatus: "idle" | "loading" | "succeeded" | "failed";
  selectedMetricId: string | null;
  onSelect: (metricId: string | null) => void;
  /** Metric panels show the selected metric's resolved measure/aggregation/
   *  format read-only (design.md D5); chart/table panels never materialize
   *  (design.md D6) — pass `false` there. */
  showResolvedFields: boolean;
}

export function MetricPicker({
  metrics,
  metricsStatus,
  selectedMetricId,
  onSelect,
  showResolvedFields,
}: MetricPickerProps) {
  const selectedMetric = metrics.find((m) => m.id === selectedMetricId) ?? null;
  const options = [
    { value: "", label: metricsStatus === "loading" ? "Loading metrics…" : "— None —" },
    ...metrics.map((m) => ({ value: m.id, label: m.name })),
  ];

  return (
    <div className="panel-detail-modal__data-section">
      <span className="panel-detail-modal__data-label">Bind to metric</span>
      <Select
        ariaLabel="Metric"
        value={selectedMetricId ?? ""}
        onChange={(v) => onSelect(v === "" ? null : v)}
        options={options}
        placeholder="Select a metric…"
      />
      {showResolvedFields && selectedMetric && (
        <dl className="panel-detail-modal__metric-resolved">
          <div className="panel-detail-modal__metric-resolved-row">
            <dt>Measure</dt>
            <dd>{selectedMetric.measureField}</dd>
          </div>
          <div className="panel-detail-modal__metric-resolved-row">
            <dt>Aggregation</dt>
            <dd>{selectedMetric.aggregation}</dd>
          </div>
          <div className="panel-detail-modal__metric-resolved-row">
            <dt>Format</dt>
            <dd>{formatMetricFormat(selectedMetric.format)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
