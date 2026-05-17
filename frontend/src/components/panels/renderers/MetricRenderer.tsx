import type { MappedPanelData } from "../../../types/models";

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

  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">{data?.value ?? "--"}</span>
      <span className="panel-content__metric-label">{data?.label ?? "No data"}</span>
      {trend && (
        <span className={`panel-content__metric-trend ${trendDirectionClass}`}>{trend}</span>
      )}
    </div>
  );
}
