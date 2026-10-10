// Edit-mode Save as a config PATCH (HEL-1389). `PATCH /api/outputs/:id` shallow-merges `config`
// (an omitted top-level key is kept, a present key replaces wholesale, an explicit `null` is
// stored as `null`), so the sheet must send only the keys the user changed, with `null` for a
// clear -- never a rebuild of the whole kind config from editor state.
//
// "Changed" means: the builder's output for the current state differs from the builder's output
// for the state the sheet OPENED with (`openingParams`, seeded exactly as the sheet seeds its
// state). Diffing against the opening state, not the raw stored config, keeps read defaults
// (`chartType: "line"` for an absent key, a normalized `{agg}` aggregation) from being written
// on an untouched save.

import { defaultBoundOrLiteralMode } from "../../../panels/ui/editors/BoundOrLiteralField";
import {
  buildOutputConfig,
  type BoundOrLiteralValue,
  type BuildOutputConfigParams,
} from "./buildOutputConfig";
import {
  readChartConfig,
  readCollectionConfig,
  readMarkdownConfig,
  readMetricConfig,
  readTableConfig,
  readTimelineConfig,
} from "./outputConfigTypes";
import { buildOutputColumns, deriveColumnOrder } from "./useOutputTableColumns";
import type { OutputKind } from "../../types/output";

function staticBound(
  literalIsSet: boolean,
  fieldValue: string,
  literalValue: string,
): BoundOrLiteralValue {
  const mode = defaultBoundOrLiteralMode(literalIsSet);
  return {
    mode,
    fieldValue,
    literalValue,
    fieldMappingValue: mode === "field" && fieldValue ? fieldValue : undefined,
  };
}

/** NOTE: `useOutputKindState` calls this with a fixed kind and reads only kind-independent fields,
 *  so this must not branch on `kind`.
 *  The builder inputs for an Output exactly as the sheet seeds its editor state from `config`
 *  (and, for a table, from the capabilities-dependent column hook), i.e. the untouched state. */
export function openingParams(
  kind: OutputKind,
  config: Record<string, unknown>,
  fieldKeys: string[],
): BuildOutputConfigParams {
  const chart = readChartConfig(config);
  const table = readTableConfig(config);
  const metric = readMetricConfig(config);
  const markdown = readMarkdownConfig(config);
  const collection = readCollectionConfig(config);
  const timeline = readTimelineConfig(config);
  return {
    kind,
    chartType: chart.chartType,
    chartFieldMapping: chart.fieldMapping,
    groupBy: chart.aggregation?.groupBy ?? "",
    chartAggFn: chart.aggregation?.agg ?? "",
    yField: chart.aggregation?.yField ?? "",
    chartOptionsState: chart.chartOptions ?? {},
    annotationState: staticBound(
      chart.annotation !== undefined && chart.annotation !== null,
      chart.fieldMapping.annotation ?? "",
      chart.annotation ?? "",
    ),
    tableFieldMapping: table.fieldMapping,
    tableColumnOrder: deriveColumnOrder(
      buildOutputColumns(fieldKeys, table.columnOrder),
      fieldKeys,
      table.columnOrder,
    ),
    tableColumnFormats: { ...(table.columnFormats ?? {}) },
    metricField: metric.fieldMapping.value ?? metric.aggregation?.value ?? "",
    metricAggFn: metric.aggregation?.agg ?? "",
    metricLabelState: staticBound(
      metric.label !== undefined,
      metric.fieldMapping.label ?? "",
      metric.label ?? "",
    ),
    metricUnitState: staticBound(
      metric.unit !== undefined,
      metric.fieldMapping.unit ?? "",
      metric.unit ?? "",
    ),
    metricFormat: metric.format ?? "number",
    compare: metric.compare ?? "none",
    markdownContent: markdown.content ?? "",
    collectionFieldMapping: collection.fieldMapping,
    collectionFormat: collection.format ?? "number",
    timelineFieldMapping: timeline.fieldMapping,
  };
}

/** `undefined` and `null` both mean "no value" on the wire; otherwise structural JSON equality. */
function sameValue(a: unknown, b: unknown): boolean {
  const left = a === undefined ? null : a;
  const right = b === undefined ? null : b;
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (k) =>
      Object.prototype.hasOwnProperty.call(right, k) &&
      sameValue((left as Record<string, unknown>)[k], (right as Record<string, unknown>)[k]),
  );
}

/** The `fieldMapping` slots the editor owns per kind (a bound-or-literal slot). */
const OWNED_SLOTS: Partial<Record<OutputKind, string[]>> = {
  chart: ["annotation"],
  metric: ["label", "unit"],
};

/** D4 -- an Output this bug already damaged: the STORED mapping carries an owned slot (non-empty
 *  string) that the editor state does not bind to that same field. Stale-slot detection only,
 *  never whole-object equality. */
function hasStaleSlot(
  kind: OutputKind,
  stored: Record<string, unknown>,
  builtMapping: unknown,
): boolean {
  const slots = OWNED_SLOTS[kind];
  const storedMapping = stored.fieldMapping;
  if (!slots || typeof storedMapping !== "object" || storedMapping === null) return false;
  const built = (builtMapping ?? {}) as Record<string, unknown>;
  return slots.some((slot) => {
    const value = (storedMapping as Record<string, unknown>)[slot];
    return typeof value === "string" && value !== "" && built[slot] !== value;
  });
}

/**
 * The config PATCH body for an edit Save: only the top-level keys of `built` the user changed
 * relative to `baseline`, a changed-to-nothing key as an explicit `null`. Returns `null` when
 * nothing changed (the caller then omits `config` from the request).
 *
 * A metric's `fieldMapping` and `aggregation` travel together (D4a): the metric's binding lives
 * in both, and a half-written pair must not unbind it.
 */
export function buildConfigPatch(
  kind: OutputKind,
  built: Record<string, unknown>,
  baseline: Record<string, unknown>,
  stored: Record<string, unknown>,
): Record<string, unknown> | null {
  const changed = new Set(Object.keys(built).filter((k) => !sameValue(built[k], baseline[k])));
  if (hasStaleSlot(kind, stored, built.fieldMapping)) changed.add("fieldMapping");
  if (kind === "metric" && (changed.has("fieldMapping") || changed.has("aggregation"))) {
    changed.add("fieldMapping");
    changed.add("aggregation");
  }
  if (changed.size === 0) return null;
  return Object.fromEntries([...changed].map((k) => [k, built[k] === undefined ? null : built[k]]));
}

/** Convenience: the baseline built through the same builder as the current state. */
export function buildBaselineConfig(
  kind: OutputKind,
  config: Record<string, unknown>,
  fieldKeys: string[],
): Record<string, unknown> {
  return buildOutputConfig(openingParams(kind, config, fieldKeys));
}
