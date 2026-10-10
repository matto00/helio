// The editor sheet's Configuration card: the per-kind field group for the selected kind (extracted
// verbatim from `OutputEditorSheet.tsx`'s kind switch).

import { Select, type SelectOption } from "../../../../shared/ui/index";
import type {
  BarChartOptions,
  LineChartOptions,
  PieChartOptions,
  ScatterChartOptions,
} from "../../../panels/types/panel";
import { chartCompareBlocker } from "../../../panels/history/chartOverlay";
import type { OutputKind } from "../../types/output";
import { buildOutputConfig } from "./buildOutputConfig";
import {
  ChartKindFields,
  MarkdownKindFields,
  METRIC_FORMAT_OPTIONS,
  MetricKindFields,
  SimpleMappingFields,
  TableKindFields,
} from "./OutputKindFields";
import type { OutputKindState } from "./useOutputKindState";

interface OutputKindConfigCardProps {
  kind: OutputKind;
  kindState: OutputKindState;
  /** Column options with a leading "None" (aggregation / metric value pickers). */
  aggFieldOptions: SelectOption[];
  fieldOptions: SelectOption[];
}

export function OutputKindConfigCard({
  kind,
  kindState,
  aggFieldOptions,
  fieldOptions,
}: OutputKindConfigCardProps) {
  const {
    chartType,
    setChartType,
    groupBy,
    setGroupBy,
    yField,
    setYField,
    chartAggFn,
    setChartAggFn,
    chartOptionsState,
    setChartOptionsState,
    annotationState,
    compare,
    setCompare,
    tableCols,
    tableFormats,
    metricField,
    setMetricField,
    metricAggFn,
    setMetricAggFn,
    metricLabelState,
    metricUnitState,
    metricFormat,
    setMetricFormat,
    markdownContent,
    setMarkdownContent,
    collectionFieldMapping,
    setCollectionFieldMapping,
    collectionFormat,
    setCollectionFormat,
    timelineFieldMapping,
    setTimelineFieldMapping,
  } = kindState;
  return (
    <div className="output-editor-sheet__group output-editor-sheet__group--card">
      <h3 className="output-editor-sheet__edit-section-heading">Configuration</h3>
      {kind === "chart" && (
        <ChartKindFields
          fieldOptions={aggFieldOptions}
          chartType={chartType}
          onChartTypeChange={setChartType}
          groupByValue={groupBy}
          onGroupByChange={setGroupBy}
          valueFieldValue={yField}
          onValueFieldChange={setYField}
          aggFnValue={chartAggFn}
          onAggFnChange={setChartAggFn}
          line={chartOptionsState.line ?? ({} as LineChartOptions)}
          onLineChange={(patch) =>
            setChartOptionsState((prev) => ({ ...prev, line: { ...prev.line, ...patch } }))
          }
          bar={chartOptionsState.bar ?? ({} as BarChartOptions)}
          onBarChange={(patch) =>
            setChartOptionsState((prev) => ({ ...prev, bar: { ...prev.bar, ...patch } }))
          }
          pie={chartOptionsState.pie ?? ({} as PieChartOptions)}
          onPieChange={(patch) =>
            setChartOptionsState((prev) => ({ ...prev, pie: { ...prev.pie, ...patch } }))
          }
          scatter={chartOptionsState.scatter ?? ({} as ScatterChartOptions)}
          onScatterChange={(patch) =>
            setChartOptionsState((prev) => ({ ...prev, scatter: { ...prev.scatter, ...patch } }))
          }
          annotationState={annotationState}
          compareValue={compare}
          onCompareChange={setCompare}
          compareBlocker={chartCompareBlocker(buildOutputConfig(kindState.params(kind)))}
        />
      )}
      {kind === "table" && (
        <TableKindFields
          columns={tableCols.columns}
          onToggleVisible={tableCols.toggleVisible}
          onMoveUp={tableCols.moveUp}
          onMoveDown={tableCols.moveDown}
          onMoveToTop={tableCols.moveToTop}
          onMoveToBottom={tableCols.moveToBottom}
          columnFormats={tableFormats.selections}
          onFormatChange={tableFormats.setFormat}
        />
      )}
      {kind === "metric" && (
        <MetricKindFields
          fieldOptions={aggFieldOptions}
          fieldValue={metricField}
          onFieldChange={setMetricField}
          reduceValue={metricAggFn}
          onReduceChange={setMetricAggFn}
          labelState={metricLabelState}
          unitState={metricUnitState}
          formatValue={metricFormat}
          onFormatChange={setMetricFormat}
          compareValue={compare}
          onCompareChange={setCompare}
        />
      )}
      {kind === "markdown" && (
        <MarkdownKindFields content={markdownContent} onContentChange={setMarkdownContent} />
      )}
      {kind === "collection" && (
        <>
          <SimpleMappingFields
            title="Item fields"
            slots={[
              { key: "value", label: "Value" },
              { key: "label", label: "Label" },
              { key: "unit", label: "Unit" },
            ]}
            fieldMapping={collectionFieldMapping}
            onFieldChange={(k, v) => setCollectionFieldMapping((prev) => ({ ...prev, [k]: v }))}
            fieldOptions={fieldOptions}
          />
          <div className="output-editor-sheet__data-section">
            <label className="output-editor-sheet__data-label" htmlFor="output-collection-format">
              Format
            </label>
            <Select
              id="output-collection-format"
              ariaLabel="Format"
              value={collectionFormat}
              onChange={setCollectionFormat}
              options={METRIC_FORMAT_OPTIONS}
            />
          </div>
        </>
      )}
      {kind === "timeline" && (
        <SimpleMappingFields
          title="Timeline fields"
          slots={[
            { key: "time", label: "Time" },
            { key: "event", label: "Event" },
          ]}
          fieldMapping={timelineFieldMapping}
          onFieldChange={(k, v) => setTimelineFieldMapping((prev) => ({ ...prev, [k]: v }))}
          fieldOptions={fieldOptions}
        />
      )}
    </div>
  );
}
