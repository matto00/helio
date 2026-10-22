import { useMemo } from "react";

import type { PanelAppearance } from "../types/panel";
import type { OutputSchemaField } from "../../pipelines/types/output";
import { readChartConfig } from "../../pipelines/ui/outputEditor/outputConfigTypes";
import type { ChartClickSelection } from "../../../utils/chartClickSelection";
import { selectChartOverlay } from "../history/chartOverlay";
import { configCompare } from "../history/metricHistoryView";
import { useOutputHistory, type HistorySource } from "../history/useOutputHistory";
import { toChartFieldTypes } from "../../../utils/chartTimeAxis";
import { sanitizeReferenceMarks } from "../../../utils/referenceMarks";
import {
  buildChartAggregate,
  chartGroupingSpec,
  resolveChartAppearance,
} from "./outputRenderInputs";
import { resolvePanelChartType } from "./resolvePanelChartType";
import { groupHasNull } from "../../../utils/blankLabel";
import { ChartRenderer } from "./renderers/ChartRenderer";

interface ChartOutputPanelProps {
  panelId: string;
  outputId: string;
  /** Absent on the public path (`PublicOutputMeta` carries none). */
  pipelineId?: string;
  config: Record<string, unknown>;
  /** HEL-1305: the Output's declared schema; a `timestamp` x field plots on a time axis. */
  schema?: OutputSchemaField[] | null;
  appearance: PanelAppearance;
  rawRows: string[][] | null | undefined;
  headers: string[] | null | undefined;
  /** HEL-1351 design D2 — the loaded row RECORDS (cross-filter-narrowed like `rawRows`). An
   *  aggregated Output is grouped from these, not from the null-to-"" stringified `rawRows`, so a
   *  missing group key is `"null"` exactly as in the editor preview and the stored summary series. */
  records?: Record<string, unknown>[] | null;
  compact?: boolean;
  onDataPointSelect?: (selection: ChartClickSelection) => void;
  /** A viewer control filter or cross-filter narrows this panel's rows. */
  filterActive: boolean;
  /** Whether more rows exist than the panel loaded; `undefined` fails closed (no overlay). */
  rowsTruncated: boolean | undefined;
  historySource?: HistorySource;
  /** HEL-1358: precomputed truncation note, forwarded to `ChartRenderer`. */
  truncationNote?: string | null;
  /** HEL-1398: the short form of `truncationNote`, shown on narrow cards. */
  truncationNoteShort?: string | null;
}

/** HEL-1277 design D9 — the chart branch of `OutputPanelContent`: reads the Output's history (only
 *  when `config.compare` is set; the same cache entry a metric panel would share) and hands
 *  `ChartRenderer` the labelled "vs" overlay when it is valid for what this panel plots. A separate
 *  component, rendered after the parent's loading early-return, so the hook never runs inline. */
export function ChartOutputPanel({
  panelId,
  outputId,
  pipelineId,
  config,
  schema,
  appearance,
  rawRows,
  headers,
  records,
  compact,
  onDataPointSelect,
  filterActive,
  rowsTruncated,
  historySource,
  truncationNote,
  truncationNoteShort,
}: ChartOutputPanelProps) {
  const cfg = readChartConfig(config);
  const compare = configCompare(config);
  // Keyed on the stored values: `readChartConfig` re-sanitizes into fresh arrays on every render.
  const referenceMarks = useMemo(
    () => sanitizeReferenceMarks(config.referenceLines, config.referenceBands),
    [config.referenceLines, config.referenceBands],
  );
  const fieldTypes = useMemo(() => toChartFieldTypes(schema), [schema]);
  const history = useOutputHistory(
    outputId,
    panelId,
    pipelineId,
    historySource,
    compare !== null,
    compare,
  );
  // HEL-1351 design D7 — the panel's stored type, else the Output's, else line; one resolver for
  // render, click mapping and Inspect.
  const chartType = resolvePanelChartType(appearance.chart, config);
  const resolvedAppearance = useMemo(
    () => resolveChartAppearance(appearance, chartType),
    [appearance, chartType],
  );
  // HEL-1351 design D1/D2 (C2) — an aggregated Output plots one value per group, grouped client-side
  // with the SAME function and condition the editor preview uses. A panel whose resolved type is
  // scatter renders raw rows (scatter never aggregates), so it neither groups nor re-keys clicks.
  const aggregationSpec = useMemo(() => chartGroupingSpec(chartType, config), [chartType, config]);
  // HEL-1408 design D10a -- null detection reads the typed records (never the null-to-"" `rawRows`),
  // strictly `=== null`, and rides on a LOCAL copy of the spec so the shared spec type is untouched.
  const groupBy = aggregationSpec?.groupBy;
  const hasNullGroup = useMemo(() => groupHasNull(records, groupBy), [groupBy, records]);
  const clickSpec = useMemo(
    () => (aggregationSpec ? { ...aggregationSpec, groupHasNull: hasNullGroup } : null),
    [aggregationSpec, hasNullGroup],
  );
  const chartAggregate = useMemo(
    () => buildChartAggregate(aggregationSpec, records, hasNullGroup),
    [aggregationSpec, records, hasNullGroup],
  );
  // An aggregated Output only overlays its grouped baseline over the grouped plot; with no record
  // rows to group from, the panel falls back to raw rows and must not draw the grouped overlay.
  const groupedPlot = aggregationSpec === null || chartAggregate !== null;
  const overlay = useMemo(
    () =>
      groupedPlot
        ? selectChartOverlay(history, config, { filterActive, rowsTruncated, rawRows, headers })
        : null,
    [groupedPlot, history, config, filterActive, rowsTruncated, rawRows, headers],
  );
  return (
    <ChartRenderer
      appearance={resolvedAppearance}
      rawRows={rawRows}
      headers={headers}
      fieldMapping={cfg.fieldMapping}
      chartAggregate={chartAggregate}
      aggregationSpec={clickSpec}
      chartOptions={cfg.chartOptions}
      annotation={cfg.annotation ?? null}
      overlay={overlay}
      referenceMarks={referenceMarks}
      fieldTypes={fieldTypes}
      truncationNote={truncationNote}
      truncationNoteShort={truncationNoteShort}
      compact={compact}
      onDataPointSelect={onDataPointSelect}
    />
  );
}
