import type { PanelAppearance } from "../../types/panel";
import type { GroupedAggregate } from "../../../../utils/aggregate";
import { ChartPanel } from "../ChartPanel";

interface ChartRendererProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
  chartAggregate?: GroupedAggregate | null;
}

export function ChartRenderer({
  appearance,
  rawRows,
  headers,
  fieldMapping,
  chartAggregate,
}: ChartRendererProps) {
  return (
    <div className="panel-content panel-content--chart">
      <ChartPanel
        appearance={appearance}
        rawRows={rawRows}
        headers={headers}
        fieldMapping={fieldMapping}
        chartAggregate={chartAggregate}
      />
    </div>
  );
}
