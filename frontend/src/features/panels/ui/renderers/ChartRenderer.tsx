import type { PanelAppearance } from "../../../../types/models";
import { ChartPanel } from "../ChartPanel";

interface ChartRendererProps {
  appearance?: PanelAppearance;
  rawRows?: string[][] | null;
  headers?: string[] | null;
  fieldMapping?: Record<string, string> | null;
}

export function ChartRenderer({ appearance, rawRows, headers, fieldMapping }: ChartRendererProps) {
  return (
    <div className="panel-content panel-content--chart">
      <ChartPanel
        appearance={appearance}
        rawRows={rawRows}
        headers={headers}
        fieldMapping={fieldMapping}
      />
    </div>
  );
}
