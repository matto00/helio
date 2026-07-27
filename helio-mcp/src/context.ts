/**
 * Workspace context serializer (HEL-222).
 *
 * Produces one compact, agent-readable snapshot of everything an agent needs
 * to reason about before composing a dashboard: data sources, DataTypes (with
 * their columns/shape), pipelines (with their ordered steps and each step's
 * output columns), and dashboards. This is what lets an agent answer
 * "which DataType is single-row?" without blind-guessing.
 *
 * Implementation is a CLIENT-SIDE FAN-OUT over existing endpoints, per the
 * brief's guidance to start simple and only add a backend `/api/context`
 * aggregation if fan-out proves too chatty. Call budget:
 *   3 list calls (sources, types, dashboards) + 1 pipelines list + 1 analyze
 *   per pipeline + 1 pipeline-shapes catalog call = 5 + N(pipelines).
 * For workspace-sized data (handfuls of each) this is well within reason; see
 * README "Context serializer" for the measured cost and the escalation trigger.
 */

import type { HelioApi } from "./helioApi.js";
import type { DataFieldResponse, RowCountContractResponse } from "./types.js";

/** Flatten a `RowCountContractResponse` discriminated union to a display string (HEL-400
 *  design.md Decision 5): `"exactly-one"`, `"at-most-param:<paramName>"`, or `"unbounded"`. */
function flattenRowCount(rowCount: RowCountContractResponse): string {
  switch (rowCount.kind) {
    case "exactly-one":
      return "exactly-one";
    case "at-most-param":
      return `at-most-param:${rowCount.paramName}`;
    case "unbounded":
      return "unbounded";
  }
}

// ── Sample rows (HEL-372 design.md D3/D6) ────────────────────────────────
//
// An INDEPENDENT TypeScript implementation of the identical caps
// `WorkspaceContextService.sanitizeSampleRows` (Scala) enforces — this
// codebase has no shared runtime between the backend and helio-mcp, so
// parity is achieved by duplicating the rules and testing each side
// separately (the existing pattern for `panelCount`/`flattenRowCount`),
// not by sharing code.

/** Bounded sample-row count per pipeline-output DataType. */
const SAMPLE_ROW_LIMIT = 5;
/** First N declared Structured-category columns retained per sample row. */
const SAMPLE_COLUMN_LIMIT = 40;
/** Per-cell character cap before truncation. */
const SAMPLE_CELL_CHAR_LIMIT = 200;
const TRUNCATION_MARKER = "…[truncated]";

/** The wire values `DataFieldType.asString` emits for its `Structured`-category
 *  variants (`string`/`integer`/`float`/`boolean`/`timestamp`) — deliberately
 *  NOT a "content types" exclusion list, so an unrecognized/unparseable
 *  `dataType` string is conservatively excluded too, matching the Scala side's
 *  `DataFieldType.fromString(...).exists(...)` behavior. */
const STRUCTURED_DATA_TYPES = new Set(["string", "integer", "float", "boolean", "timestamp"]);

/** `JSON.stringify` is the TS equivalent of spray-json's `compactPrint` for
 *  the scalar/array/object JSON values a row cell can hold — same length
 *  semantics (e.g. a string value's stringified form includes its quotes). */
function truncateCell(value: unknown): unknown {
  const compact = JSON.stringify(value);
  if (compact !== undefined && compact.length > SAMPLE_CELL_CHAR_LIMIT) {
    return compact.slice(0, SAMPLE_CELL_CHAR_LIMIT) + TRUNCATION_MARKER;
  }
  return value;
}

/** Pure, unit-testable sanitizer mirroring `WorkspaceContextService.sanitizeSampleRows`
 *  (design.md D3): (1) column projection — keep only Structured-category `fields`
 *  (unparseable/Content dataType excluded), first `SAMPLE_COLUMN_LIMIT` in declared
 *  order; (2) row projection — first `SAMPLE_ROW_LIMIT` rows (defense-in-depth; the
 *  real call path already asks the backend for at most 5 via `getDataTypeRows`'s
 *  `limit` param); (3) cell truncation, exact marker text `"…[truncated]"`. */
export function sanitizeSampleRows(
  fields: Pick<DataFieldResponse, "name" | "dataType">[],
  rawRows: Record<string, unknown>[],
): Record<string, unknown>[] {
  const structuredFieldNames = fields
    .filter((f) => STRUCTURED_DATA_TYPES.has(f.dataType))
    .slice(0, SAMPLE_COLUMN_LIMIT)
    .map((f) => f.name);

  return rawRows.slice(0, SAMPLE_ROW_LIMIT).map((row) => {
    const projected: Record<string, unknown> = {};
    for (const name of structuredFieldNames) {
      if (Object.prototype.hasOwnProperty.call(row, name)) {
        projected[name] = truncateCell(row[name]);
      }
    }
    return projected;
  });
}

export interface WorkspaceContext {
  generatedAt: string;
  counts: {
    dataSources: number;
    dataTypes: number;
    pipelines: number;
    dashboards: number;
  };
  dataSources: Array<{ id: string; name: string; type: string; tag: string | null }>;
  dataTypes: Array<{
    id: string;
    name: string;
    sourceId: string | null;
    /** true when this DataType is a pipeline output (panel-bindable). */
    pipelineOutput: boolean;
    columns: Array<{ name: string; dataType: string; nullable: boolean }>;
    computedColumns: Array<{ name: string; dataType: string; expression: string }>;
    version: number;
    /** HEL-366: free-form grouping key, mirrors the owning DataSource's or producing Pipeline's
     *  tag; `null` when unset. */
    tag: string | null;
    /** HEL-372: up to 5 rows from this DataType's latest pipeline-run snapshot, keyed by
     *  column name — capped to the first 40 declared Structured-category columns and 200
     *  characters per cell (see `sanitizeSampleRows`). ALWAYS present (`[]`, never omitted)
     *  for a source-companion DataType or one with no run snapshot. */
    sampleRows: Record<string, unknown>[];
  }>;
  pipelines: Array<{
    id: string;
    name: string;
    sourceDataSourceId: string;
    sourceDataSourceName: string;
    outputDataTypeId: string;
    outputDataTypeName: string;
    lastRunStatus: string | null;
    lastRunAt: string | null;
    lastRunRowCount: number | null;
    /** HEL-366: free-form grouping key; `null` when unset. */
    tag: string | null;
    steps: Array<{
      position: number;
      type: string;
      outputColumns: string[];
      validationError: string | null;
    }>;
    /** set when the analyze fan-out for this pipeline failed */
    stepsError?: string;
  }>;
  dashboards: Array<{ id: string; name: string; panelCount: number }>;
  /** Smart pipeline shape catalog (HEL-391/402) — the shape vocabulary a planning agent can pick
   *  from via create_pipeline_from_shape, rather than inventing shape ids. `outputRowCount` flattens
   *  `RowCountContract` to a string. */
  pipelineShapes: Array<{
    id: string;
    label: string;
    description: string;
    paramsSchema: Array<{
      name: string;
      label: string;
      dataType: string;
      required: boolean;
      description: string;
    }>;
    outputRowCount: string;
    outputDescription: string;
  }>;
}

/** Distinct panelIds referenced across all four breakpoints of a layout. */
function panelCount(layout: {
  lg: Array<{ panelId: string }>;
  md: Array<{ panelId: string }>;
  sm: Array<{ panelId: string }>;
  xs: Array<{ panelId: string }>;
}): number {
  const ids = new Set<string>();
  for (const bp of [layout.lg, layout.md, layout.sm, layout.xs]) {
    for (const item of bp) ids.add(item.panelId);
  }
  return ids.size;
}

export async function buildWorkspaceContext(api: HelioApi): Promise<WorkspaceContext> {
  const [sourcesPage, typesPage, dashboardsPage, pipelineSummaries, pipelineShapes] =
    await Promise.all([
      api.listDataSources(),
      api.listDataTypes(),
      api.listDashboards(),
      api.listPipelines(),
      api.listPipelineShapes(),
    ]);

  // Fan out one analyze per pipeline for steps + per-step output columns.
  const pipelines = await Promise.all(
    pipelineSummaries.map(async (summary) => {
      const base = {
        id: summary.id,
        name: summary.name,
        sourceDataSourceId: summary.sourceDataSourceId,
        sourceDataSourceName: summary.sourceDataSourceName,
        outputDataTypeId: summary.outputDataTypeId,
        outputDataTypeName: summary.outputDataTypeName,
        lastRunStatus: summary.lastRunStatus,
        lastRunAt: summary.lastRunAt,
        lastRunRowCount: summary.lastRunRowCount,
        tag: summary.tag ?? null,
      };
      try {
        const analyzed = await api.analyzePipeline(summary.id);
        return {
          ...base,
          steps: analyzed.steps.map((step) => ({
            position: step.position,
            type: step.type,
            outputColumns: step.outputSchema.map((f) => f.name),
            validationError: step.validationError,
          })),
        };
      } catch (err) {
        return { ...base, steps: [], stepsError: (err as Error).message };
      }
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    counts: {
      dataSources: sourcesPage.total,
      dataTypes: typesPage.total,
      pipelines: pipelineSummaries.length,
      dashboards: dashboardsPage.total,
    },
    dataSources: sourcesPage.items.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      tag: s.tag ?? null,
    })),
    dataTypes: await Promise.all(
      typesPage.items.map(async (t) => {
        // spray-json omits `sourceId` entirely when it is null, so a MISSING
        // field is the pipeline-output (panel-bindable) case. Normalize before
        // deciding — `=== null` alone would misclassify the bindable type.
        const sourceId = t.sourceId ?? null;
        const pipelineOutput = sourceId === null;
        // Sample rows only for pipeline-output DataTypes (design.md D2) — a
        // source-companion DataType is never written to the row snapshot
        // table, so a query for one would always return empty; skip it
        // entirely rather than pay a guaranteed-empty round trip.
        // `excludeContentFields=true` strips Content-category (string-body/
        // binary-ref, HEL-217) field values at the SQL tier (design.md D1).
        const sampleRows = pipelineOutput
          ? sanitizeSampleRows(
              t.fields,
              (await api.getDataTypeRows(t.id, SAMPLE_ROW_LIMIT, true)).rows,
            )
          : [];
        return {
          id: t.id,
          name: t.name,
          sourceId,
          pipelineOutput,
          columns: t.fields.map((f) => ({
            name: f.name,
            dataType: f.dataType,
            nullable: f.nullable,
          })),
          computedColumns: t.computedFields.map((c) => ({
            name: c.name,
            dataType: c.dataType,
            expression: c.expression,
          })),
          version: t.version,
          tag: t.tag ?? null,
          sampleRows,
        };
      }),
    ),
    pipelines,
    dashboards: dashboardsPage.items.map((d) => ({
      id: d.id,
      name: d.name,
      panelCount: panelCount(d.layout),
    })),
    pipelineShapes: pipelineShapes.map((s) => ({
      id: s.id,
      label: s.label,
      description: s.description,
      paramsSchema: s.paramsSchema,
      outputRowCount: flattenRowCount(s.outputContract.rowCount),
      outputDescription: s.outputContract.description,
    })),
  };
}
