import "./PanelContent.css";
import type { PanelType } from "../types/models";

function MetricContent() {
  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">--</span>
      <span className="panel-content__metric-label">No data</span>
    </div>
  );
}

function ChartContent() {
  const heights = [40, 65, 50, 80, 55];
  return (
    <div className="panel-content panel-content--chart" aria-hidden="true">
      {heights.map((h, i) => (
        <span key={i} className="panel-content__bar" style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function TextContent() {
  return (
    <div className="panel-content panel-content--text" aria-hidden="true">
      <span className="panel-content__text-line panel-content__text-line--long" />
      <span className="panel-content__text-line panel-content__text-line--short" />
    </div>
  );
}

function TableContent() {
  return (
    <div className="panel-content panel-content--table">
      <table className="panel-content__table" aria-hidden="true">
        <thead>
          <tr>
            <th />
            <th />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
          <tr>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface PanelContentProps {
  type: PanelType;
}

export function PanelContent({ type }: PanelContentProps) {
  switch (type) {
    case "metric":
      return <MetricContent />;
    case "chart":
      return <ChartContent />;
    case "text":
      return <TextContent />;
    case "table":
      return <TableContent />;
    default:
      return <MetricContent />;
  }
}
