// Per-kind config field groups for `OutputEditorSheet.tsx` (task 5.1/5.2/5.3/
// 5.4). Reuses the panel-editor presentational field-group components
// verbatim (they're already generic on `SelectOption[]`, not `DataType` --
// verified against their source before this file was written) re-pointed at
// capabilities-at-node column options instead of a bound DataType's fields
// (design.md decision 3). `MetricPicker`/`useMetricBindingState`/
// `DataTypePicker` are NOT used here -- HEL-903 dropped the `Metric`/
// `DataType` entities, so the metric-kind slot below is just the field+reduce
// value control plus label/unit, matching design.md decision 3's "collapse
// into the sheet's metric-kind slot".

import { Select, Textarea, type SelectOption } from "../../../../shared/ui/index";
import type { ChartType } from "../../../../utils/chartAppearance";
import { ChartAggregationFields } from "../../../panels/ui/editors/ChartAggregationFields";
import { ChartDisplayFields } from "../../../panels/ui/editors/ChartDisplayFields";
import { TableDisplayFields } from "../../../panels/ui/editors/TableDisplayFields";
import { MetricValueEditor } from "../../../panels/ui/editors/MetricValueEditor";
import { BoundOrLiteralField } from "../../../panels/ui/editors/BoundOrLiteralField";
import type { BoundOrLiteralState } from "../../../panels/ui/editors/useBoundOrLiteralState";
import type {
  BarChartOptions,
  LineChartOptions,
  PieChartOptions,
  ScatterChartOptions,
} from "../../../panels/types/panel";
import type { TableColumnRow } from "./useOutputTableColumns";
import type { ColumnFormatSelection } from "./useOutputColumnFormats";

const CHART_TYPE_OPTIONS: SelectOption[] = [
  { value: "line", label: "Line" },
  { value: "bar", label: "Bar" },
  { value: "pie", label: "Pie" },
  { value: "scatter", label: "Scatter" },
];

interface ChartKindFieldsProps {
  fieldOptions: SelectOption[];
  chartType: ChartType;
  onChartTypeChange: (t: ChartType) => void;
  groupByValue: string;
  onGroupByChange: (v: string) => void;
  valueFieldValue: string;
  onValueFieldChange: (v: string) => void;
  aggFnValue: string;
  onAggFnChange: (v: string) => void;
  line: LineChartOptions;
  onLineChange: (patch: Partial<LineChartOptions>) => void;
  bar: BarChartOptions;
  onBarChange: (patch: Partial<BarChartOptions>) => void;
  pie: PieChartOptions;
  onPieChange: (patch: Partial<PieChartOptions>) => void;
  scatter: ScatterChartOptions;
  onScatterChange: (patch: Partial<ScatterChartOptions>) => void;
  annotationState: BoundOrLiteralState;
}

export function ChartKindFields({
  fieldOptions,
  chartType,
  onChartTypeChange,
  groupByValue,
  onGroupByChange,
  valueFieldValue,
  onValueFieldChange,
  aggFnValue,
  onAggFnChange,
  line,
  onLineChange,
  bar,
  onBarChange,
  pie,
  onPieChange,
  scatter,
  onScatterChange,
  annotationState,
}: ChartKindFieldsProps) {
  return (
    <>
      <div className="output-editor-sheet__data-section">
        <label className="output-editor-sheet__data-label" htmlFor="output-chart-type">
          Chart type
        </label>
        <Select
          ariaLabel="Chart type"
          value={chartType}
          onChange={(v) => onChartTypeChange(v as ChartType)}
          options={CHART_TYPE_OPTIONS}
        />
      </div>
      {chartType === "scatter" ? (
        <div className="output-editor-sheet__data-section">
          <span className="output-editor-sheet__data-label">Aggregation</span>
          <p className="output-editor-sheet__type-hint">
            Aggregation isn&apos;t available for scatter — each point plots a raw row.
          </p>
        </div>
      ) : (
        <ChartAggregationFields
          fieldOptions={fieldOptions}
          groupByValue={groupByValue}
          onGroupByChange={onGroupByChange}
          valueFieldValue={valueFieldValue}
          onValueFieldChange={onValueFieldChange}
          aggFnValue={aggFnValue}
          onAggFnChange={onAggFnChange}
        />
      )}
      <ChartDisplayFields
        chartType={chartType}
        line={line}
        onLineChange={onLineChange}
        bar={bar}
        onBarChange={onBarChange}
        pie={pie}
        onPieChange={onPieChange}
        scatter={scatter}
        onScatterChange={onScatterChange}
        fieldOptions={fieldOptions}
        isBound={fieldOptions.length > 0}
        annotationState={annotationState}
      />
    </>
  );
}

interface TableKindFieldsProps {
  columns: TableColumnRow[];
  onToggleVisible: (key: string) => void;
  onMoveUp: (index: number) => void;
  onMoveDown: (index: number) => void;
  onMoveToTop: (index: number) => void;
  onMoveToBottom: (index: number) => void;
  /** HEL-469 — per-column format selection ("none" | format type), keyed by
   *  column name; a column with no entry is treated as "none". */
  columnFormats: Record<string, ColumnFormatSelection>;
  onFormatChange: (key: string, type: ColumnFormatSelection) => void;
}

export function TableKindFields({
  columns,
  onToggleVisible,
  onMoveUp,
  onMoveDown,
  onMoveToTop,
  onMoveToBottom,
  columnFormats,
  onFormatChange,
}: TableKindFieldsProps) {
  return (
    <TableDisplayFields
      density="normal"
      onDensityChange={() => {
        // Density isn't part of the Output config model yet -- table Outputs
        // render at normal density only until a real consumer needs it.
      }}
      columns={columns}
      onToggleVisible={onToggleVisible}
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onMoveToTop={onMoveToTop}
      onMoveToBottom={onMoveToBottom}
      hasStoredWidths={false}
      resetWidthsPending={false}
      onResetWidths={() => {}}
      columnFormats={columnFormats}
      onFormatChange={onFormatChange}
    />
  );
}

export const METRIC_FORMAT_OPTIONS: SelectOption[] = [
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "currency", label: "Currency ($)" },
  { value: "percent", label: "Percent (%)" },
];

/** HEL-1275 design.md D7 — `config.compare` choices. A pre-existing `custom:<duration>` value is
 *  appended as its own option by `compareOptions` so opening and saving never silently drops it. */
export const METRIC_COMPARE_OPTIONS: SelectOption[] = [
  { value: "none", label: "None" },
  { value: "previous_run", label: "Previous" },
  { value: "1d", label: "1 day" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

function compareOptions(value: string): SelectOption[] {
  return value.startsWith("custom:")
    ? [...METRIC_COMPARE_OPTIONS, { value, label: `Custom (${value.slice("custom:".length)})` }]
    : METRIC_COMPARE_OPTIONS;
}

interface MetricKindFieldsProps {
  fieldOptions: SelectOption[];
  fieldValue: string;
  onFieldChange: (v: string) => void;
  reduceValue: string;
  onReduceChange: (v: string) => void;
  labelState: BoundOrLiteralState;
  unitState: BoundOrLiteralState;
  /** HEL-876 — numeric display style; `"number"` matches the pre-HEL-876
   *  default rendering. */
  formatValue: string;
  onFormatChange: (v: string) => void;
  /** HEL-1275 — `"none"` or a `config.compare` token. */
  compareValue: string;
  onCompareChange: (v: string) => void;
}

export function MetricKindFields({
  fieldOptions,
  fieldValue,
  onFieldChange,
  reduceValue,
  onReduceChange,
  labelState,
  unitState,
  formatValue,
  onFormatChange,
  compareValue,
  onCompareChange,
}: MetricKindFieldsProps) {
  return (
    <>
      <MetricValueEditor
        fieldOptions={fieldOptions}
        fieldValue={fieldValue}
        onFieldChange={onFieldChange}
        reduceValue={reduceValue}
        onReduceChange={onReduceChange}
      />
      <div className="output-editor-sheet__data-section">
        <label className="output-editor-sheet__data-label" htmlFor="output-metric-format">
          Format
        </label>
        <Select
          ariaLabel="Format"
          value={formatValue}
          onChange={onFormatChange}
          options={METRIC_FORMAT_OPTIONS}
        />
      </div>
      <div className="output-editor-sheet__data-section">
        <span className="output-editor-sheet__data-label">Compare</span>
        <Select
          ariaLabel="Compare"
          value={compareValue}
          onChange={onCompareChange}
          options={compareOptions(compareValue)}
        />
      </div>
      <div className="output-editor-sheet__data-section">
        <span className="output-editor-sheet__data-label">Label &amp; Unit</span>
        <BoundOrLiteralField
          label="Label"
          mode={labelState.mode}
          onModeChange={labelState.setMode}
          fieldOptions={fieldOptions}
          fieldValue={labelState.fieldValue}
          onFieldChange={labelState.setFieldValue}
          literalValue={labelState.literalValue}
          onLiteralChange={labelState.setLiteralValue}
          literalPlaceholder="e.g. Revenue"
        />
        <BoundOrLiteralField
          label="Unit"
          mode={unitState.mode}
          onModeChange={unitState.setMode}
          fieldOptions={fieldOptions}
          fieldValue={unitState.fieldValue}
          onFieldChange={unitState.setFieldValue}
          literalValue={unitState.literalValue}
          onLiteralChange={unitState.setLiteralValue}
          literalPlaceholder="e.g. $, %, ms"
        />
      </div>
    </>
  );
}

interface MarkdownKindFieldsProps {
  content: string;
  onContentChange: (value: string) => void;
}

/** A markdown Output's Content is the literal `config.content` only
 *  (HEL-1139): `OutputBindingSpec.Markdown` declares no fieldMapping slots
 *  (the backend 400s `fieldMapping.content`) and the renderer never reads a
 *  binding. Data-bound narrative text is HEL-921's planned `insight` kind. */
export function MarkdownKindFields({ content, onContentChange }: MarkdownKindFieldsProps) {
  return (
    <div className="output-editor-sheet__data-section">
      <div className="panel-detail-modal__mapping-row panel-detail-modal__mapping-row--align-top">
        <span className="panel-detail-modal__mapping-label">Content</span>
        <Textarea
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          placeholder="# Hello&#10;Write your markdown here…"
          aria-label="Content text"
          rows={12}
        />
      </div>
    </div>
  );
}

interface SimpleMappingFieldsProps {
  title: string;
  slots: { key: string; label: string }[];
  fieldMapping: Record<string, string>;
  onFieldChange: (slotKey: string, value: string) => void;
  fieldOptions: SelectOption[];
}

/** Collection/Timeline kinds (task 5.1's lighter-weight slots) -- a generic
 *  per-slot field-mapping loop, mirroring `FieldMappingSlots` but inlined
 *  here rather than reused directly since neither kind renders through
 *  `PANEL_SLOTS` any more (that map is keyed by `PanelType`, not
 *  `OutputKind`). */
export function SimpleMappingFields({
  title,
  slots,
  fieldMapping,
  onFieldChange,
  fieldOptions,
}: SimpleMappingFieldsProps) {
  return (
    <div className="output-editor-sheet__data-section">
      <span className="output-editor-sheet__data-label">{title}</span>
      {slots.map((slot) => (
        <div key={slot.key} className="output-editor-sheet__mapping-row">
          <label className="output-editor-sheet__mapping-label" htmlFor={`output-slot-${slot.key}`}>
            {slot.label}
          </label>
          <Select
            ariaLabel={`${slot.label} field`}
            value={fieldMapping[slot.key] ?? ""}
            onChange={(v) => onFieldChange(slot.key, v)}
            placeholder="— None —"
            options={fieldOptions}
          />
        </div>
      ))}
    </div>
  );
}
