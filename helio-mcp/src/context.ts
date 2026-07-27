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

/** Bounded sample-row count per pipeline-output DataType. `sampleRows` is
 *  derived from the first `SAMPLE_ROW_LIMIT` of the shared `STATS_ROW_LIMIT`-
 *  wide fetch below (HEL-373 design.md D1) — its own output is unchanged. */
const SAMPLE_ROW_LIMIT = 5;
/** Shared fetch's row bound (HEL-373 design.md D1): raised from
 *  `SAMPLE_ROW_LIMIT` (5) to 500, matching the backend's `StatsRowLimit`.
 *  Both `sampleRows` and `columnStats` are derived from this ONE fetch. */
const STATS_ROW_LIMIT = 500;
/** First N declared Structured-category columns retained per sample row and
 *  per `columnStats` — enforced BOTH at the SQL tier (`maxStructuredColumns`
 *  query param) and independently by `computeColumnStats`'s own column
 *  enumeration (HEL-373 design.md D2). */
const SAMPLE_COLUMN_LIMIT = 40;
/** Per-cell character cap before truncation. */
const SAMPLE_CELL_CHAR_LIMIT = 200;
const TRUNCATION_MARKER = "…[truncated]";
/** `distinctCount` stops distinguishing beyond this cap (HEL-373 design.md
 *  D4); `distinctCountCapped: true` reports "at least this many". */
const DISTINCT_COUNT_CAP = 100;
/** Max `exampleValues` entries per column (HEL-373 design.md D6). */
const EXAMPLE_VALUE_LIMIT = 5;
/** `mean`'s fixed rounding precision (HEL-373 design.md D5/D6 determinism). */
const MEAN_ROUNDING_FACTOR = 10000;

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

// ── Column statistics (HEL-373 design.md D2/D3/D4/D5/D6) ────────────────────
//
// An INDEPENDENT TypeScript implementation of the identical caps
// `WorkspaceContextService.computeColumnStats` (Scala) enforces — no shared
// runtime between the backend and helio-mcp (design.md D10), so parity is
// achieved by duplicating the rules and testing each side separately, not by
// sharing code.

export interface ColumnStats {
  nullRate: number;
  distinctCount: number;
  distinctCountCapped: boolean;
  exampleValues: unknown[];
  /** Numeric-column-only (integer/float declared type); present only when at
   *  least one fetched value parses as numeric. Omitted (not present as a
   *  key), never `null` — mirrors the Scala side's `Option` → spray-json
   *  field-omission wire behavior (design.md D7). */
  min?: number;
  max?: number;
  mean?: number;
}

/** Computes the raw numeric candidate for `asNumeric` (design.md D5) WITHOUT
 *  any finiteness filtering — a JSON `number` directly, or a JSON `string`
 *  via a trimmed, empty-string-rejecting `Number(...)` parse (CSV sources
 *  read numeric-declared columns as strings at runtime); everything else
 *  (boolean/object/array) is `undefined`. Deliberately does NOT decide
 *  finiteness itself — see `asNumeric`'s single exit-point filter below for
 *  why that check lives at the boundary, not per-branch. */
function rawNumericCandidate(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return undefined;
    return Number(trimmed);
  }
  return undefined;
}

/** Numeric parsing (design.md D5): delegates to `rawNumericCandidate` for the
 *  per-branch conversion, then applies `Number.isFinite` ONCE, at this single
 *  exit point — not per-branch.
 *
 *  **Single exit-point finiteness filter (HEL-373 skeptic-final-2.md,
 *  human-mandated restructure after skeptic-final-1.md's per-branch patch
 *  missed a sibling instance of the same bug)**: a large-magnitude numeric
 *  JSON literal can overflow to `±Infinity` regardless of which branch
 *  produced the candidate — `JSON.parse("1e400")` (exactly what the HTTP
 *  response layer does) yields the native JS value `Infinity` on the
 *  `typeof "number"` branch, and `Number("Infinity")`/`Number("-Infinity")`
 *  parse successfully to non-finite numbers on the `typeof "string"` branch.
 *  Either path would otherwise poison `numericMax`/`mean` to `Infinity`,
 *  which then silently wire-serializes to `null` via `JSON.stringify`.
 *  Filtering once at the exit makes this function structurally incapable of
 *  returning a non-finite value regardless of which branch produced it, and
 *  any future branch added to `rawNumericCandidate` inherits the guarantee
 *  automatically — symmetric with the Scala side's single
 *  `.filter(_.isFinite)` applied to its whole `match` result. Everything
 *  else (boolean/object/array/unparseable string) is `undefined` — excluded
 *  from `min`/`max`/`mean`, NOT counted as null, NOT treated as `0`. */
export function asNumeric(value: unknown): number | undefined {
  const candidate = rawNumericCandidate(value);
  return candidate !== undefined && Number.isFinite(candidate) ? candidate : undefined;
}

/** Pure, unit-testable statistics computer mirroring
 *  `WorkspaceContextService.computeColumnStats` (design.md D2/D3/D4/D5/D6):
 *  (1) column projection — same rule as `sanitizeSampleRows` (Structured-
 *  category `fields`, first `SAMPLE_COLUMN_LIMIT` in declared order) —
 *  REQUIRED and independent of the `maxStructuredColumns` HTTP param the real
 *  call path already sends (design.md D2 round-3); (2) per column, fold over
 *  ALL of `rawRows` (not row-capped, unlike `sanitizeSampleRows` — statistics
 *  are computed over the full shared fetch, up to `STATS_ROW_LIMIT`);
 *  (3) `nullRate`/`distinctCount`(capped)/`exampleValues` for every column;
 *  `min`/`max`/`mean` additionally for `integer`/`float`-declared columns. */
export function computeColumnStats(
  fields: Pick<DataFieldResponse, "name" | "dataType">[],
  rawRows: Record<string, unknown>[],
): Record<string, ColumnStats> {
  const structuredFields = fields
    .filter((f) => STRUCTURED_DATA_TYPES.has(f.dataType))
    .slice(0, SAMPLE_COLUMN_LIMIT);

  const result: Record<string, ColumnStats> = {};
  for (const field of structuredFields) {
    result[field.name] = computeColumnStatsForField(field, rawRows);
  }
  return result;
}

/** Rounds an already-scaled value to the nearest integer, breaking an EXACT
 *  tie AWAY FROM ZERO — matching Java's `BigDecimal.RoundingMode.HALF_UP`
 *  semantics the Scala side's `roundToFourDecimals` uses (design.md D5/D6
 *  cross-language determinism; HEL-373 skeptic-final-4.md finding, fixed
 *  under human direction to align TS to Scala, not the reverse). Plain
 *  `Math.round` breaks ties TOWARD +Infinity instead (e.g. `Math.round(-0.5)
 *  === -0`), which diverges from `HALF_UP` for a NEGATIVE exact tie — e.g. a
 *  mean that divides to exactly `-0.00005`: `HALF_UP` rounds to `-0.0001`,
 *  `Math.round`'s own tie-break rounds to `-0`/`0`. This is the ONLY case the
 *  two conventions disagree on — every non-tie value already rounds
 *  identically under both (a fractional part other than exactly `0.5` has a
 *  unique nearest integer regardless of tie-break rule), so this wrapper
 *  changes behavior at ties only. */
function roundHalfAwayFromZero(scaled: number): number {
  return scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled);
}

/** Rounds `value` to 4 decimal places (design.md D5/D6 determinism) WITHOUT
 *  the naive `Math.round(value * 10000) / 10000` technique's own overflow
 *  surface — HEL-373 skeptic-final-3.md round-3 fix. That technique's
 *  multiply-by-10000 step can itself overflow to `Infinity` for a
 *  legitimately large-but-finite `value` (e.g. one enormous-but-real outlier
 *  averaged with many ordinary rows) well before `value` itself is anywhere
 *  near `Number.MAX_VALUE`, which would otherwise silently produce `NaN`/
 *  `Infinity` — mirrors the Scala side's `BigDecimal.setScale`-based fix
 *  (same rationale, different mechanism: JS has no arbitrary-precision
 *  decimal type in the standard library, so this instead detects the
 *  overflow before it happens and falls back to the unrounded — but still
 *  correctly finite — `value`, since rounding to 4 decimal places is a
 *  practical no-op at a magnitude where the multiply itself would overflow).
 *  Tie-breaking delegates to `roundHalfAwayFromZero` (HEL-373
 *  skeptic-final-4.md) so this matches the Scala side's `HALF_UP` convention
 *  exactly, not just in magnitude. Callers are responsible for ensuring
 *  `value` is already finite (this function does not itself guard
 *  non-finite input). */
function roundToFourDecimals(value: number): number {
  const scaled = value * MEAN_ROUNDING_FACTOR;
  if (!Number.isFinite(scaled)) return value;
  return roundHalfAwayFromZero(scaled) / MEAN_ROUNDING_FACTOR;
}

function computeColumnStatsForField(
  field: Pick<DataFieldResponse, "name" | "dataType">,
  rawRows: Record<string, unknown>[],
): ColumnStats {
  const isNumericField = field.dataType === "integer" || field.dataType === "float";
  const totalRows = rawRows.length;

  let nullCount = 0;
  const distinctSeen = new Set<string>();
  const exampleValues: unknown[] = [];
  const exampleKeysSeen = new Set<string>();
  let numericCount = 0;
  let numericSum = 0;
  let numericMin = Number.POSITIVE_INFINITY;
  let numericMax = Number.NEGATIVE_INFINITY;

  for (const row of rawRows) {
    const present = Object.prototype.hasOwnProperty.call(row, field.name);
    const value = row[field.name];
    if (!present || value === null) {
      nullCount += 1;
      continue;
    }

    const truncated = truncateCell(value);
    const truncatedKey = JSON.stringify(truncated);

    // Distinct-count set: stops growing once already past the cap (design.md
    // D4 — never allowed past 101 entries).
    if (distinctSeen.size <= DISTINCT_COUNT_CAP && !distinctSeen.has(truncatedKey)) {
      distinctSeen.add(truncatedKey);
    }

    // Example values: first 5 distinct, truncated, non-null values in row
    // order (design.md D6 determinism).
    if (exampleValues.length < EXAMPLE_VALUE_LIMIT && !exampleKeysSeen.has(truncatedKey)) {
      exampleValues.push(truncated);
      exampleKeysSeen.add(truncatedKey);
    }

    if (isNumericField) {
      const n = asNumeric(value);
      if (n !== undefined) {
        numericCount += 1;
        numericSum += n;
        numericMin = Math.min(numericMin, n);
        numericMax = Math.max(numericMax, n);
      }
    }
  }

  const distinctCountCapped = distinctSeen.size > DISTINCT_COUNT_CAP;
  const distinctCount = Math.min(distinctSeen.size, DISTINCT_COUNT_CAP);
  const nullRate = totalRows === 0 ? 0 : nullCount / totalRows;

  const stats: ColumnStats = { nullRate, distinctCount, distinctCountCapped, exampleValues };
  if (numericCount > 0) {
    // HEL-373 skeptic-final-3.md, human-mandated placement: the terminal
    // boundary before `stats` is returned and serialized — the ONE place a
    // "no non-finite min/max/mean" invariant can be enforced totally,
    // regardless of whether the non-finite value originated from a per-value
    // parse (asNumeric, already airtight per rounds 1-2) or from aggregation
    // itself (`numericSum` overflowing to `Infinity` across many
    // individually-finite values, round 3's finding — `numericMin`/
    // `numericMax` cannot overflow the same way since they're `Math.min`/
    // `Math.max` over already-finite operands, but are guarded here too so
    // the invariant covers all three fields uniformly). INVARIANT: no
    // `ColumnStats` may ever be constructed containing a non-finite
    // min/max/mean — a non-finite value is simply omitted (`undefined`), same
    // "excluded, not fabricated, not zero" semantics `asNumeric` already
    // established for individual values.
    const rawMean = numericSum / numericCount;
    if (Number.isFinite(numericMin)) stats.min = numericMin;
    if (Number.isFinite(numericMax)) stats.max = numericMax;
    if (Number.isFinite(rawMean)) stats.mean = roundToFourDecimals(rawMean);
  }
  return stats;
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
    /** HEL-373: per-column statistics keyed by column name, one entry per
     *  Structured-category column (capped at the first 40, same bound as
     *  `sampleRows`). Computed over the SAME bounded (≤500-row) fetch
     *  `sampleRows` is derived from. ALWAYS present (`{}`, never omitted) for
     *  a source-companion DataType or one with no run snapshot yet — see
     *  `computeColumnStats`. */
    columnStats: Record<string, ColumnStats>;
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
        // Sample rows + column stats only for pipeline-output DataTypes
        // (design.md D2) — a source-companion DataType is never written to
        // the row snapshot table, so a query for one would always return
        // empty; skip it entirely rather than pay a guaranteed-empty round
        // trip. `excludeContentFields=true` strips Content-category (string-
        // body/binary-ref, HEL-217) field values at the SQL tier (design.md
        // D1); `maxStructuredColumns=SAMPLE_COLUMN_LIMIT` strips Structured
        // column overflow beyond 40 at the SQL tier too (HEL-373 design.md
        // D1). ONE fetch (`STATS_ROW_LIMIT`, 500 rows) serves both
        // `sanitizeSampleRows` (unchanged, still self-limits to 5) and the
        // new `computeColumnStats` (HEL-373 design.md D10).
        const rawRows = pipelineOutput
          ? (await api.getDataTypeRows(t.id, STATS_ROW_LIMIT, true, SAMPLE_COLUMN_LIMIT)).rows
          : [];
        const sampleRows = pipelineOutput ? sanitizeSampleRows(t.fields, rawRows) : [];
        const columnStats = pipelineOutput ? computeColumnStats(t.fields, rawRows) : {};
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
          columnStats,
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
