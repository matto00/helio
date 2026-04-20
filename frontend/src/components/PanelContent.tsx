import "./PanelContent.css";
import type { MappedPanelData, PanelAppearance, PanelType } from "../types/models";
import { ChartPanel } from "./ChartPanel";

interface MetricContentProps {
  data?: MappedPanelData | null;
}

function MetricContent({ data }: MetricContentProps) {
  return (
    <div className="panel-content panel-content--metric">
      <span className="panel-content__metric-value">{data?.value ?? "--"}</span>
      <span className="panel-content__metric-label">{data?.label ?? "No data"}</span>
    </div>
  );
}

interface TextContentProps {
  data?: MappedPanelData | null;
}

function TextContent({ data }: TextContentProps) {
  if (data?.content) {
    return (
      <div className="panel-content panel-content--text">
        <span className="panel-content__text-live">{data.content}</span>
      </div>
    );
  }
  return (
    <div className="panel-content panel-content--text" aria-hidden="true">
      <span className="panel-content__text-line panel-content__text-line--long" />
      <span className="panel-content__text-line panel-content__text-line--short" />
    </div>
  );
}

interface TableContentProps {
  data?: MappedPanelData | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
}

function TableContent({ rawRows, headers }: TableContentProps) {
  if (rawRows && rawRows.length > 0) {
    const cols = headers ?? rawRows[0].map((_, i) => String(i + 1));
    return (
      <div className="panel-content panel-content--table">
        <table className="panel-content__table">
          <thead>
            <tr>
              {cols.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rawRows.map((row, ri) => (
              <tr key={ri}>
                {row.map((cell, ci) => (
                  <td key={ci}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
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

export interface PanelContentProps {
  type: PanelType;
  data?: MappedPanelData | null;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  isLoading?: boolean;
  error?: string | null;
  noData?: boolean;
  appearance?: PanelAppearance;
}

export function PanelContent({
  type,
  data,
  rawRows,
  headers,
  isLoading,
  error,
  noData,
  appearance,
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

  switch (type) {
    case "metric":
      return <MetricContent data={data} />;
    case "chart":
      return <ChartPanel appearance={appearance} />;
    case "text":
      return <TextContent data={data} />;
    case "table":
      return <TableContent data={data} rawRows={rawRows} headers={headers} />;
    default:
      return <MetricContent data={data} />;
  }
}
