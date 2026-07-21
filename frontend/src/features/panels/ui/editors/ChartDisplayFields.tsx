// HEL-248 — Chart panel per-chart-type display controls for the panel detail
// modal's edit pane. Purely presentational: all state + save/dirty/reset
// plumbing lives in `useChartDisplayState` (owned by `BindingEditor`),
// mirroring how `TableDisplayFields` / `ChartAggregationFields` are driven.
//
// Exactly one chart type's controls render at a time, chosen by the *live*
// chart type selected in the Appearance section — so changing the type swaps
// the Display controls before save. Every control maps to a real ECharts
// construct (see `ChartPanel.tsx`).

import { Select, TextField, type SelectOption } from "../../../../shared/ui/index";
import type {
  BarChartOptions,
  LineChartOptions,
  PieChartOptions,
  ScatterChartOptions,
} from "../../types/panel";
import type { ChartType } from "../../../../utils/chartAppearance";
import { BoundOrLiteralField } from "./BoundOrLiteralField";
import type { BoundOrLiteralState } from "./useBoundOrLiteralState";

const ORIENTATION_OPTIONS: SelectOption[] = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
];

const STACKING_OPTIONS: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "stacked", label: "Stacked" },
  { value: "normalized", label: "Normalized (100%)" },
];

const DEFAULT_BAR_GAP_PCT = 20;

interface ChartDisplayFieldsProps {
  chartType: ChartType;
  line: LineChartOptions;
  onLineChange: (patch: Partial<LineChartOptions>) => void;
  bar: BarChartOptions;
  onBarChange: (patch: Partial<BarChartOptions>) => void;
  pie: PieChartOptions;
  onPieChange: (patch: Partial<PieChartOptions>) => void;
  scatter: ScatterChartOptions;
  onScatterChange: (patch: Partial<ScatterChartOptions>) => void;
  /** Field options for the scatter size/color selects (no "— None —" prefix —
   *  added here). Empty when no DataType is bound. */
  fieldOptions: SelectOption[];
  /** True when a DataType is bound — scatter field selects are only meaningful
   *  once columns exist, and the annotation's "Bind to field" mode is only
   *  offered once a DataType is bound (HEL-323). */
  isBound: boolean;
  /** HEL-318 / HEL-323: the annotation source (static subtitle/footnote text
   *  OR a bound DataType column). Driven by a `useBoundOrLiteralState` instance
   *  owned by `BindingEditor`: "Fixed text" persists `config.annotation`,
   *  "Bind to field" persists `fieldMapping.annotation`. */
  annotationState: BoundOrLiteralState;
}

function isBarOrientation(value: string): value is NonNullable<BarChartOptions["orientation"]> {
  return value === "vertical" || value === "horizontal";
}

function isBarStacking(value: string): value is NonNullable<BarChartOptions["stacking"]> {
  return value === "none" || value === "stacked" || value === "normalized";
}

function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <div className="panel-detail-modal__data-section">
      <label className="panel-detail-modal__toggle-row">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="panel-detail-modal__toggle-label">{label}</span>
      </label>
      {hint ? <p className="panel-detail-modal__field-hint">{hint}</p> : null}
    </div>
  );
}

export function ChartDisplayFields({
  chartType,
  line,
  onLineChange,
  bar,
  onBarChange,
  pie,
  onPieChange,
  scatter,
  onScatterChange,
  fieldOptions,
  isBound,
  annotationState,
}: ChartDisplayFieldsProps) {
  const fieldSelectOptions: SelectOption[] = [{ value: "", label: "— None —" }, ...fieldOptions];

  return (
    <>
      <h3 className="panel-detail-modal__edit-section-heading">Display</h3>

      {/* HEL-323 — "Bind to field" is only offered once a DataType is bound
          (mirroring the scatter field gating below); an unbound chart keeps the
          fixed-text-only control it had since HEL-318. The bound branch lets
          `BoundOrLiteralField` own the single "Annotation" label (its own
          `mapping-label`), so the section renders no separate outer label — the
          unbound branch keeps its own `<label>` for the plain TextField. */}
      {isBound ? (
        <div className="panel-detail-modal__data-section">
          <BoundOrLiteralField
            label="Annotation"
            mode={annotationState.mode}
            onModeChange={annotationState.setMode}
            fieldOptions={fieldOptions}
            fieldValue={annotationState.fieldValue}
            onFieldChange={annotationState.setFieldValue}
            literalValue={annotationState.literalValue}
            onLiteralChange={annotationState.setLiteralValue}
            literalPlaceholder="Optional subtitle shown beneath the chart"
          />
        </div>
      ) : (
        <div className="panel-detail-modal__data-section">
          <label className="panel-detail-modal__data-label" htmlFor="chart-annotation">
            Annotation
          </label>
          <TextField
            id="chart-annotation"
            type="text"
            value={annotationState.literalValue}
            onChange={(e) => annotationState.setLiteralValue(e.target.value)}
            aria-label="Annotation"
            placeholder="Optional subtitle shown beneath the chart"
          />
        </div>
      )}

      {chartType === "line" && (
        <>
          <ToggleRow
            label="Smooth lines"
            checked={line.smooth ?? false}
            onChange={(checked) => onLineChange({ smooth: checked })}
          />
          <ToggleRow
            label="Point markers"
            checked={line.showPoints ?? true}
            onChange={(checked) => onLineChange({ showPoints: checked })}
          />
          <ToggleRow
            label="Area fill"
            checked={line.areaFill ?? false}
            onChange={(checked) => onLineChange({ areaFill: checked })}
            hint="Shades the area beneath the line."
          />
        </>
      )}

      {chartType === "bar" && (
        <>
          <div className="panel-detail-modal__data-section">
            <div className="panel-detail-modal__mapping-row">
              <label className="panel-detail-modal__mapping-label" htmlFor="bar-orientation">
                Orientation
              </label>
              <Select
                ariaLabel="Bar orientation"
                value={bar.orientation ?? "vertical"}
                onChange={(value) => {
                  if (isBarOrientation(value)) onBarChange({ orientation: value });
                }}
                options={ORIENTATION_OPTIONS}
              />
            </div>
          </div>
          <div className="panel-detail-modal__data-section">
            <div className="panel-detail-modal__mapping-row">
              <label className="panel-detail-modal__mapping-label" htmlFor="bar-stacking">
                Stacking
              </label>
              <Select
                ariaLabel="Bar stacking"
                value={bar.stacking ?? "none"}
                onChange={(value) => {
                  if (isBarStacking(value)) onBarChange({ stacking: value });
                }}
                options={STACKING_OPTIONS}
              />
            </div>
            <p className="panel-detail-modal__field-hint">
              Normalized scales each category to 100% to compare proportions.
            </p>
          </div>
          <label className="panel-detail-modal__slider">
            <span>Group spacing</span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={bar.barGapPct ?? DEFAULT_BAR_GAP_PCT}
              onChange={(e) => onBarChange({ barGapPct: Number(e.target.value) })}
              aria-label="Bar group spacing"
            />
            <strong>{bar.barGapPct ?? DEFAULT_BAR_GAP_PCT}%</strong>
          </label>
        </>
      )}

      {chartType === "pie" && (
        <>
          <label className="panel-detail-modal__slider">
            <span>Donut hole</span>
            <input
              type="range"
              min="0"
              max="90"
              step="1"
              value={pie.donutHolePct ?? 0}
              onChange={(e) => onPieChange({ donutHolePct: Number(e.target.value) })}
              aria-label="Donut hole size"
            />
            <strong>{pie.donutHolePct ?? 0}%</strong>
          </label>
          <ToggleRow
            label="Percentage labels"
            checked={pie.showPercentLabels ?? false}
            onChange={(checked) => onPieChange({ showPercentLabels: checked })}
            hint="Shows each slice's share of the total."
          />
        </>
      )}

      {chartType === "scatter" &&
        (isBound ? (
          <>
            <div className="panel-detail-modal__data-section">
              <div className="panel-detail-modal__mapping-row">
                <label className="panel-detail-modal__mapping-label" htmlFor="scatter-size-field">
                  Point size field
                </label>
                <Select
                  ariaLabel="Scatter point size field"
                  value={scatter.sizeField ?? ""}
                  onChange={(value) => onScatterChange({ sizeField: value || undefined })}
                  placeholder="— None —"
                  options={fieldSelectOptions}
                />
              </div>
              <p className="panel-detail-modal__field-hint">
                Scales each point&apos;s size by this field&apos;s value (bubble chart).
              </p>
            </div>
            <div className="panel-detail-modal__data-section">
              <div className="panel-detail-modal__mapping-row">
                <label className="panel-detail-modal__mapping-label" htmlFor="scatter-color-field">
                  Color by field
                </label>
                <Select
                  ariaLabel="Scatter color-by field"
                  value={scatter.colorField ?? ""}
                  onChange={(value) => onScatterChange({ colorField: value || undefined })}
                  placeholder="— None —"
                  options={fieldSelectOptions}
                />
              </div>
              <p className="panel-detail-modal__field-hint">
                Groups points into one color/legend entry per distinct value.
              </p>
            </div>
          </>
        ) : (
          <p className="panel-detail-modal__type-hint">
            Bind a data type to configure point size and color fields.
          </p>
        ))}
    </>
  );
}
