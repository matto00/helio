// Chart subtype creator fields — chart type selector (line / bar / pie /
// scatter).
//
// Rendered by PanelCreationModal's name-entry step when selectedType is
// "chart". The shell narrows `typeConfig` into a `ChartTypeConfig` before
// passing it in so the Select stays controlled from first render.

import { Select } from "../../../../shared/ui/index";
import type { ChartTypeConfig } from "../../types/panel";
import type { CreatorFieldsProps } from "./creatorTypes";

type CreationChartType = NonNullable<ChartTypeConfig["chartType"]>;

export function ChartCreatorFields({ config, onChange }: CreatorFieldsProps<ChartTypeConfig>) {
  return (
    <div className="panel-creation-modal__field">
      <label className="panel-creation-modal__label" htmlFor="panel-create-chart-type">
        Chart type
      </label>
      <Select
        ariaLabel="Chart type"
        value={config.chartType ?? ""}
        onChange={(v) =>
          onChange({ ...config, chartType: v ? (v as CreationChartType) : undefined })
        }
        placeholder="Select chart type"
        options={[
          { value: "line", label: "Line" },
          { value: "bar", label: "Bar" },
          { value: "pie", label: "Pie" },
          { value: "scatter", label: "Scatter" },
        ]}
      />
    </div>
  );
}
