// Pure config-assembly for `OutputEditorSheet.tsx`'s Save action, extracted
// out of the sheet component to keep it under the CONTRIBUTING.md ~400-line
// file-size soft budget (task 5.1). One function per kind's config shape
// (`outputConfigTypes.ts`).

import type { ChartType } from "../../../../utils/chartAppearance";
import type { ChartTypeOptionsMap } from "../../../panels/types/panel";
import type { BoundOrLiteralState } from "../../../panels/ui/editors/useBoundOrLiteralState";
import type { AggregateConfig } from "../../types/pipelineStep";
import type { NodeCapabilities, OutputKind } from "../../types/output";
import { isAggFn } from "./outputConfigTypes";

export interface BuildOutputConfigParams {
  kind: OutputKind;
  // Chart
  chartType: ChartType;
  chartFieldMapping: Record<string, string>;
  groupBy: string;
  chartAggFn: string;
  yField: string;
  chartOptionsState: ChartTypeOptionsMap;
  annotationState: BoundOrLiteralState;
  // Table
  tableFieldMapping: Record<string, string>;
  tableColumnOrder: string[] | undefined;
  // Metric
  metricField: string;
  metricAggFn: string;
  metricLabelState: BoundOrLiteralState;
  metricUnitState: BoundOrLiteralState;
  // Markdown
  markdownContentState: BoundOrLiteralState;
  // Collection / Timeline
  collectionFieldMapping: Record<string, string>;
  timelineFieldMapping: Record<string, string>;
}

export function buildOutputConfig(params: BuildOutputConfigParams): Record<string, unknown> {
  switch (params.kind) {
    case "chart":
      return {
        chartType: params.chartType,
        fieldMapping: {
          ...params.chartFieldMapping,
          ...(params.annotationState.mode === "field" && params.annotationState.fieldValue
            ? { annotation: params.annotationState.fieldValue }
            : {}),
        },
        aggregation:
          params.groupBy && params.yField && isAggFn(params.chartAggFn)
            ? { groupBy: params.groupBy, agg: params.chartAggFn, yField: params.yField }
            : null,
        chartOptions: params.chartOptionsState,
        annotation:
          params.annotationState.mode === "literal" && params.annotationState.literalValue.trim()
            ? params.annotationState.literalValue
            : null,
      };
    case "table":
      return {
        fieldMapping: params.tableFieldMapping,
        columnOrder: params.tableColumnOrder,
      };
    case "metric":
      return {
        fieldMapping: {
          ...(params.metricAggFn === "" && params.metricField ? { value: params.metricField } : {}),
          ...(params.metricLabelState.fieldMappingValue
            ? { label: params.metricLabelState.fieldMappingValue }
            : {}),
          ...(params.metricUnitState.fieldMappingValue
            ? { unit: params.metricUnitState.fieldMappingValue }
            : {}),
        },
        aggregation:
          params.metricField && isAggFn(params.metricAggFn)
            ? { value: params.metricField, agg: params.metricAggFn }
            : null,
        label:
          params.metricLabelState.mode === "literal"
            ? params.metricLabelState.literalValue
            : undefined,
        unit:
          params.metricUnitState.mode === "literal"
            ? params.metricUnitState.literalValue
            : undefined,
      };
    case "markdown":
      return {
        content:
          params.markdownContentState.mode === "literal"
            ? params.markdownContentState.literalValue
            : "",
        fieldMapping:
          params.markdownContentState.mode === "field" && params.markdownContentState.fieldValue
            ? { content: params.markdownContentState.fieldValue }
            : {},
      };
    case "collection":
      return { fieldMapping: params.collectionFieldMapping, layout: "grid" };
    case "timeline":
      return { fieldMapping: params.timelineFieldMapping, sort: "asc" };
    default:
      return {};
  }
}

/** task 5.6 -- "Add as tail with aggregate": whether the sheet's currently
 *  configured chart/metric aggregation fields are complete enough to attach
 *  as a new `aggregate` pipeline step (design.md decision 5). Only chart and
 *  metric kinds carry aggregation fields in this sheet today -- the other
 *  four kinds have no aggregation slot, so the affordance is n/a for them. */
export function canAddAsTailWithAggregate(
  params: Pick<BuildOutputConfigParams, "kind" | "groupBy" | "chartAggFn" | "yField"> &
    Pick<BuildOutputConfigParams, "metricField" | "metricAggFn">,
): boolean {
  if (params.kind === "chart") {
    return Boolean(params.groupBy && params.yField && isAggFn(params.chartAggFn));
  }
  if (params.kind === "metric") {
    return Boolean(params.metricField && isAggFn(params.metricAggFn));
  }
  return false;
}

/** task 5.6 -- builds the `aggregate` step config to attach as a tail off the
 *  chosen node, plus the resulting Output.config for the sheet's kind
 *  attached to that NEW (already-aggregated) node. Because the aggregate
 *  step groups by the original column name and emits the aggregation under
 *  a fresh `alias` column (backend `AggregateStep` semantics: `groupBy`
 *  columns pass through unchanged, `aggregations[].alias` is the new value
 *  column), the resulting Output.config must reference `alias`, not the
 *  pre-aggregation field name, and carries no further Output-level
 *  aggregation of its own -- the data arriving at the new node is already
 *  one row per group. */
export function buildAggregateTailConfigs(
  params: Pick<
    BuildOutputConfigParams,
    | "kind"
    | "groupBy"
    | "chartAggFn"
    | "yField"
    | "chartType"
    | "chartOptionsState"
    | "annotationState"
    | "metricField"
    | "metricAggFn"
    | "metricLabelState"
    | "metricUnitState"
  >,
  capabilities: NodeCapabilities | undefined,
): { aggregateConfig: AggregateConfig; outputConfig: Record<string, unknown> } | null {
  if (!canAddAsTailWithAggregate(params)) return null;

  if (params.kind === "chart") {
    const alias = `${params.chartAggFn}_${params.yField}`;
    const groupByType =
      capabilities?.columns.find((c) => c.name === params.groupBy)?.dataType ?? "string";
    return {
      aggregateConfig: {
        groupBy: [{ name: params.groupBy, type: groupByType }],
        aggregations: [{ alias, fn: params.chartAggFn, field: params.yField }],
      },
      outputConfig: {
        chartType: params.chartType,
        fieldMapping: { category: params.groupBy, value: alias },
        aggregation: null,
        chartOptions: params.chartOptionsState,
        annotation:
          params.annotationState.mode === "literal" && params.annotationState.literalValue.trim()
            ? params.annotationState.literalValue
            : null,
      },
    };
  }

  // metric -- no groupBy slot in this sheet (a metric Output is a single
  // value), so the aggregate step groups over nothing (whole-table reduce).
  const alias = `${params.metricAggFn}_${params.metricField}`;
  return {
    aggregateConfig: {
      groupBy: [],
      aggregations: [{ alias, fn: params.metricAggFn, field: params.metricField }],
    },
    outputConfig: {
      fieldMapping: { value: alias },
      aggregation: null,
      label:
        params.metricLabelState.mode === "literal"
          ? params.metricLabelState.literalValue
          : undefined,
      unit:
        params.metricUnitState.mode === "literal" ? params.metricUnitState.literalValue : undefined,
    },
  };
}
