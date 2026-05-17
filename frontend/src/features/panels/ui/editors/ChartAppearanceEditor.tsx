import type { Dispatch, SetStateAction } from "react";

import { Select, TextField } from "../../../../shared/ui/index";
import type { ChartAppearance } from "../../../../types/models";

interface ChartAppearanceEditorProps {
  chartAppearance: ChartAppearance;
  setChartAppearance: Dispatch<SetStateAction<ChartAppearance>>;
}

/** Chart appearance form section (series colors, legend, axes, chart type)
 *  extracted from `PanelDetailModal` so the modal stays under the file-size
 *  cap. State lives in the parent (chart appearance feeds the unified
 *  appearance accumulator). */
export function ChartAppearanceEditor({
  chartAppearance,
  setChartAppearance,
}: ChartAppearanceEditorProps) {
  return (
    <div className="panel-detail-modal__chart-section">
      <span className="panel-detail-modal__section-heading">Chart</span>

      <div className="panel-detail-modal__chart-subsection">
        <span className="panel-detail-modal__chart-label">Series colors</span>
        <div className="panel-detail-modal__color-swatches">
          {chartAppearance.seriesColors.map((hex, i) => (
            <input
              key={i}
              type="color"
              value={hex}
              aria-label={`Series color ${String(i + 1)}`}
              onChange={(e) =>
                setChartAppearance((prev) => {
                  const next = [...prev.seriesColors];
                  next[i] = e.target.value;
                  return { ...prev, seriesColors: next };
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="panel-detail-modal__chart-subsection">
        <label className="panel-detail-modal__chart-label">
          <input
            type="checkbox"
            checked={chartAppearance.legend.show}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                legend: { ...prev.legend, show: e.target.checked },
              }))
            }
            aria-label="Show legend"
          />
          Show legend
        </label>
        {chartAppearance.legend.show && (
          <div className="panel-detail-modal__row">
            <label className="panel-detail-modal__field">
              <span>Legend position</span>
              <Select
                ariaLabel="Legend position"
                value={chartAppearance.legend.position}
                onChange={(v) =>
                  setChartAppearance((prev) => ({
                    ...prev,
                    legend: {
                      ...prev.legend,
                      position: v as "top" | "bottom" | "left" | "right",
                    },
                  }))
                }
                options={[
                  { value: "top", label: "Top" },
                  { value: "bottom", label: "Bottom" },
                  { value: "left", label: "Left" },
                  { value: "right", label: "Right" },
                ]}
              />
            </label>
          </div>
        )}
      </div>

      <div className="panel-detail-modal__chart-subsection">
        <label className="panel-detail-modal__chart-label">
          <input
            type="checkbox"
            checked={chartAppearance.tooltip.enabled}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                tooltip: { enabled: e.target.checked },
              }))
            }
            aria-label="Enable tooltip"
          />
          Enable tooltip
        </label>
      </div>

      <div className="panel-detail-modal__chart-subsection">
        <label className="panel-detail-modal__chart-label">
          <input
            type="checkbox"
            checked={chartAppearance.axisLabels.x.show}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                axisLabels: {
                  ...prev.axisLabels,
                  x: { ...prev.axisLabels.x, show: e.target.checked },
                },
              }))
            }
            aria-label="Show X-axis label"
          />
          Show X-axis label
        </label>
        {chartAppearance.axisLabels.x.show && (
          <TextField
            type="text"
            placeholder="X axis label text"
            value={chartAppearance.axisLabels.x.label ?? ""}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                axisLabels: {
                  ...prev.axisLabels,
                  x: { ...prev.axisLabels.x, label: e.target.value },
                },
              }))
            }
            aria-label="X-axis label text"
          />
        )}
      </div>

      <div className="panel-detail-modal__chart-subsection">
        <label className="panel-detail-modal__chart-label">
          <input
            type="checkbox"
            checked={chartAppearance.axisLabels.y.show}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                axisLabels: {
                  ...prev.axisLabels,
                  y: { ...prev.axisLabels.y, show: e.target.checked },
                },
              }))
            }
            aria-label="Show Y-axis label"
          />
          Show Y-axis label
        </label>
        {chartAppearance.axisLabels.y.show && (
          <TextField
            type="text"
            placeholder="Y axis label text"
            value={chartAppearance.axisLabels.y.label ?? ""}
            onChange={(e) =>
              setChartAppearance((prev) => ({
                ...prev,
                axisLabels: {
                  ...prev.axisLabels,
                  y: { ...prev.axisLabels.y, label: e.target.value },
                },
              }))
            }
            aria-label="Y-axis label text"
          />
        )}
      </div>

      <div className="panel-detail-modal__chart-type-section">
        <span className="panel-detail-modal__chart-type-label">Chart type</span>
        <div className="panel-detail-modal__chart-type-selector">
          {(
            [
              { type: "bar", icon: "▊", label: "Bar" },
              { type: "line", icon: "∿", label: "Line" },
              { type: "pie", icon: "◑", label: "Pie" },
              { type: "scatter", icon: "⁖", label: "Scatter" },
            ] as const
          ).map(({ type, icon, label }) => (
            <label
              key={type}
              className={[
                "panel-detail-modal__chart-type-option",
                chartAppearance.chartType === type
                  ? "panel-detail-modal__chart-type-option--active"
                  : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <input
                type="radio"
                name="chartType"
                value={type}
                checked={chartAppearance.chartType === type}
                onChange={() => setChartAppearance((prev) => ({ ...prev, chartType: type }))}
                aria-label={`Chart type ${type}`}
                className="panel-detail-modal__chart-type-radio"
              />
              <span className="panel-detail-modal__chart-type-icon">{icon}</span>
              <span className="panel-detail-modal__chart-type-name">{label}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
