// The per-kind editor state of `OutputEditorSheet.tsx` (six kinds x a handful of fields each),
// seeded from `configPatch.ts`'s `openingParams` -- the SAME function that builds the edit-Save
// baseline -- so the sheet's opening state and the baseline it diffs against cannot drift apart.
// State is seeded once per mount; a different Output needs a remount (the page keys the sheet by
// Output id).

import { useMemo, useState } from "react";

import type { ChartType } from "../../../../utils/chartAppearance";
import type { ChartTypeOptionsMap } from "../../../panels/types/panel";
import {
  useBoundOrLiteralState,
  type BoundOrLiteralState,
} from "../../../panels/ui/editors/useBoundOrLiteralState";
import type { OutputKind } from "../../types/output";
import type { BuildOutputConfigParams } from "./buildOutputConfig";
import { openingParams } from "./configPatch";
import { readTableConfig } from "./outputConfigTypes";
import { useOutputColumnFormats, type OutputColumnFormatsState } from "./useOutputColumnFormats";
import { useOutputTableColumns, type OutputTableColumnsState } from "./useOutputTableColumns";

export interface OutputKindState {
  // Chart
  chartType: ChartType;
  setChartType: (t: ChartType) => void;
  chartFieldMapping: Record<string, string>;
  groupBy: string;
  setGroupBy: (v: string) => void;
  chartAggFn: string;
  setChartAggFn: (v: string) => void;
  yField: string;
  setYField: (v: string) => void;
  chartOptionsState: ChartTypeOptionsMap;
  setChartOptionsState: (updater: (prev: ChartTypeOptionsMap) => ChartTypeOptionsMap) => void;
  annotationState: BoundOrLiteralState;
  // Table
  tableFieldMapping: Record<string, string>;
  tableCols: OutputTableColumnsState;
  tableFormats: OutputColumnFormatsState;
  // Metric
  metricField: string;
  setMetricField: (v: string) => void;
  metricAggFn: string;
  setMetricAggFn: (v: string) => void;
  metricLabelState: BoundOrLiteralState;
  metricUnitState: BoundOrLiteralState;
  metricFormat: string;
  setMetricFormat: (v: string) => void;
  compare: string;
  setCompare: (v: string) => void;
  // Markdown
  markdownContent: string;
  setMarkdownContent: (v: string) => void;
  // Collection / Timeline
  collectionFieldMapping: Record<string, string>;
  setCollectionFieldMapping: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  timelineFieldMapping: Record<string, string>;
  setTimelineFieldMapping: (
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void;
  collectionFormat: string;
  setCollectionFormat: (v: string) => void;
  /** The builder inputs for the current state, for `kind`. */
  params: (kind: OutputKind) => BuildOutputConfigParams;
}

/** `capabilityKeys` are the node's column names; they load after mount, so the table columns hook
 *  (unlike every other field) follows them rather than being seeded once. */
export function useOutputKindState(
  config: Record<string, unknown>,
  capabilityKeys: string[],
): OutputKindState {
  // Only the kind-independent fields are read from the seed, so the kind argument is immaterial.
  const seed = useMemo(() => openingParams("chart", config, []), [config]);
  const tableColumnOrder = useMemo(() => readTableConfig(config).columnOrder, [config]);

  // Chart
  const [chartType, setChartType] = useState<ChartType>(seed.chartType);
  const [chartFieldMapping] = useState(seed.chartFieldMapping);
  const [groupBy, setGroupBy] = useState(seed.groupBy);
  const [chartAggFn, setChartAggFn] = useState<string>(seed.chartAggFn);
  const [yField, setYField] = useState(seed.yField);
  const [chartOptionsState, setChartOptionsState] = useState<ChartTypeOptionsMap>(
    seed.chartOptionsState,
  );
  const annotationState = useBoundOrLiteralState(
    seed.annotationState.mode,
    seed.annotationState.fieldValue,
    seed.annotationState.literalValue,
  );

  // Table
  const [tableFieldMapping] = useState(seed.tableFieldMapping);
  const tableCols = useOutputTableColumns(capabilityKeys, tableColumnOrder);
  const tableFormats = useOutputColumnFormats(seed.tableColumnFormats);

  // Metric
  // An aggregated metric stores its field in `aggregation.value`, not `fieldMapping.value`;
  // reading only the latter silently dropped the aggregation on the next save (HEL-1275).
  const [metricField, setMetricField] = useState(seed.metricField);
  const [metricAggFn, setMetricAggFn] = useState<string>(seed.metricAggFn);
  const metricLabelState = useBoundOrLiteralState(
    seed.metricLabelState.mode,
    seed.metricLabelState.fieldValue,
    seed.metricLabelState.literalValue,
  );
  const metricUnitState = useBoundOrLiteralState(
    seed.metricUnitState.mode,
    seed.metricUnitState.fieldValue,
    seed.metricUnitState.literalValue,
  );
  const [metricFormat, setMetricFormat] = useState<string>(seed.metricFormat);
  const [compare, setCompare] = useState<string>(seed.compare);

  // Markdown
  // Literal-only (HEL-1139): a legacy `fieldMapping.content` is ignored on open;
  // an edit Save leaves it stored unless the user changes the content (HEL-1389).
  const [markdownContent, setMarkdownContent] = useState(seed.markdownContent);

  // Collection / Timeline (lighter-weight slots -- task 5.1)
  const [collectionFieldMapping, setCollectionFieldMapping] = useState(seed.collectionFieldMapping);
  const [timelineFieldMapping, setTimelineFieldMapping] = useState(seed.timelineFieldMapping);
  const [collectionFormat, setCollectionFormat] = useState<string>(seed.collectionFormat);

  return {
    chartType,
    setChartType,
    chartFieldMapping,
    groupBy,
    setGroupBy,
    chartAggFn,
    setChartAggFn,
    yField,
    setYField,
    chartOptionsState,
    setChartOptionsState,
    annotationState,
    tableFieldMapping,
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
    compare,
    setCompare,
    markdownContent,
    setMarkdownContent,
    collectionFieldMapping,
    setCollectionFieldMapping,
    timelineFieldMapping,
    setTimelineFieldMapping,
    collectionFormat,
    setCollectionFormat,
    params: (kind) => ({
      kind,
      chartType,
      chartFieldMapping,
      groupBy,
      chartAggFn,
      yField,
      chartOptionsState,
      annotationState,
      tableFieldMapping,
      tableColumnOrder: tableCols.columnOrder,
      tableColumnFormats: tableFormats.columnFormats,
      metricField,
      metricAggFn,
      metricLabelState,
      metricUnitState,
      metricFormat,
      compare,
      markdownContent,
      collectionFieldMapping,
      collectionFormat,
      timelineFieldMapping,
    }),
  };
}
