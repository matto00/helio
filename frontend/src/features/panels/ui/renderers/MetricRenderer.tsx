import type { MappedPanelData } from "../../types/panel";
interface MetricRendererProps {
  data?: MappedPanelData | null;
}

export function MetricRenderer({ data }: MetricRendererProps) {
  const trend = data?.trend;
  const trendDirectionClass = trend
    ? trend.startsWith("+")
      ? "panel-content__metric-trend--up"
      : trend.startsWith("-")
        ? "panel-content__metric-trend--down"
        : "panel-content__metric-trend--flat"
    : null;

  // `value`, `label`, and `unit` are all column references resolved via usePanelData
  // (`firstRow[field]`), not literal text — a metric with, say, `label` mapped to a column
  // that isn't present on the fetched rows resolves to an empty string here, same as an
  // unmapped slot. The literal-text override path (typed directly in panel config, rather
  // than resolved from a bound column) is out of scope for this ticket; see the sibling
  // config-depth ticket under HEL-291.
  const hasValue = !!data?.value;

  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">
        {data?.value ?? "--"}
        {data?.unit && <span className="panel-content__metric-unit">{data.unit}</span>}
      </span>
      {/* The "No data" fallback is keyed on value presence, not label presence — a missing
          label alone should not present as a data-availability problem. */}
      {hasValue ? (
        data?.label && <span className="panel-content__metric-label">{data.label}</span>
      ) : (
        <span className="panel-content__metric-label">No data</span>
      )}
      {trend && (
        <span className={`panel-content__metric-trend ${trendDirectionClass}`}>{trend}</span>
      )}
    </div>
  );
}
