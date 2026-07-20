import type { ChartTypeOptionsMap, PanelAppearance } from "../../types/panel";
import type { GroupedAggregate } from "../../../../utils/aggregate";
import { ChartPanel } from "../ChartPanel";

interface ChartRendererProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartAggregate?: GroupedAggregate | null;
  /** HEL-248: forwarded to `ChartPanel` — persisted per-type display options. */
  chartOptions?: ChartTypeOptionsMap | null;
  /** HEL-318: optional static subtitle/footnote rendered beneath the chart
   *  canvas. Absent/blank renders nothing. */
  annotation?: string | null;
  /** HEL-301: forwarded to `ChartPanel` — see its `compact` prop. */
  compact?: boolean;
}

export function ChartRenderer({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
  chartOptions,
  annotation,
  compact,
}: ChartRendererProps) {
  const trimmedAnnotation = annotation?.trim();
  return (
    <div className="panel-content panel-content--chart">
      <div className="chart-panel__canvas">
        <ChartPanel
          appearance={appearance}
          rawRows={rawRows}
          headers={headers}
          fieldMapping={fieldMapping}
          chartAggregate={chartAggregate}
          chartOptions={chartOptions}
          compact={compact}
        />
      </div>
      {trimmedAnnotation ? (
        <p className="chart-panel__annotation" title={trimmedAnnotation}>
          {trimmedAnnotation}
        </p>
      ) : null}
    </div>
  );
}
