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
import type { DataFieldResponse, MetricFormat, RowCountContractResponse } from "./types.js";

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

// ── Semantic role classification (HEL-374 design.md D1) ──────────────────────
//
// An INDEPENDENT TypeScript implementation of the identical 8-step precedence
// `WorkspaceContextService.classifySemanticRole` (Scala) enforces — no shared
// runtime between the backend and helio-mcp, so parity is achieved by
// duplicating the rules and testing each side separately, not by sharing code.

/** The wire values `dataType` string literals used for Content-category
 *  fields (HEL-217) — mirrors the Scala side's `FieldTypeCategory.Content`.
 *  Checked FIRST (step 1), before any name heuristic, so a Content field can
 *  never be misclassified `temporal`/`identifier` by its name alone. */
const CONTENT_DATA_TYPES = new Set(["string-body", "binary-ref"]);

/** `classifySemanticRole`'s string→dimension cardinality ceiling (design.md
 *  D1 step 7) — matches the Scala side's `DimensionCardinalityThreshold`. */
const DIMENSION_CARDINALITY_THRESHOLD = 50;

const TEMPORAL_NAME_TOKENS = new Set(["date", "time", "timestamp", "dob"]);
const IDENTIFIER_NAME_TOKENS = new Set(["id", "uuid", "guid"]);

export type SemanticRole = "temporal" | "dimension" | "measure" | "identifier" | "boolean" | "text";

/** Name-token normalization (design.md D1 steps 4/5): camelCase boundary
 *  insertion (`fooBar` -> `foo_Bar`), lowercase, split on `_`. The ONE shared
 *  implementation for BOTH the temporal-token check (step 4) and the
 *  identifier-token check (step 5) — token-exact matching throughout, never
 *  substring (a raw `.includes("date")`/`.includes("guid")` would
 *  misclassify `validated`/`estimated`/`guidance`/`guideline`/`misguided`).
 *  Also reused verbatim by `computeJoinHints`'s name-bucket grouping key
 *  (design.md D2) — one normalization helper, not a forked copy, mirroring
 *  the Scala side's `normalizedNameTokens`. */
export function normalizedNameTokens(name: string): string[] {
  const snakeCase = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return snakeCase.split("_").filter((t) => t.length > 0);
}

function isTemporalName(tokens: string[]): boolean {
  return (
    tokens.some((t) => TEMPORAL_NAME_TOKENS.has(t)) ||
    (tokens.length > 1 && tokens[tokens.length - 1] === "at")
  );
}

function isIdentifierName(tokens: string[]): boolean {
  return tokens.some((t) => IDENTIFIER_NAME_TOKENS.has(t));
}

/** Mirrors `WorkspaceContextService.classifySemanticRole` (Scala, design.md
 *  D1's 8-step precedence): (1) Content-category `dataType` -> `text`
 *  (unconditional, no value inspection); (2) declared `boolean` -> `boolean`;
 *  (3) declared `timestamp` -> `temporal`; (4) temporal name token ->
 *  `temporal`; (5) identifier name token -> `identifier`; (6) declared
 *  `integer`/`float` -> `measure`; (7) declared `string` with real evidence
 *  (`distinctCount > 0`, not `distinctCountCapped`, `distinctCount <=
 *  DIMENSION_CARDINALITY_THRESHOLD`) -> `dimension`, otherwise `text`;
 *  (8) unparseable/unrecognized `dataType` -> `text` (falls through every
 *  declared-type check above; steps 4/5 can still fire since they're
 *  name-only). */
export function classifySemanticRole(
  field: Pick<DataFieldResponse, "name" | "dataType">,
  stats: ColumnStats | undefined,
): SemanticRole {
  const tokens = normalizedNameTokens(field.name);

  if (CONTENT_DATA_TYPES.has(field.dataType)) return "text";
  if (field.dataType === "boolean") return "boolean";
  if (field.dataType === "timestamp") return "temporal";
  if (isTemporalName(tokens)) return "temporal";
  if (isIdentifierName(tokens)) return "identifier";
  if (field.dataType === "integer" || field.dataType === "float") return "measure";
  if (field.dataType === "string") {
    const lowCardinality =
      stats !== undefined &&
      stats.distinctCount > 0 &&
      !stats.distinctCountCapped &&
      stats.distinctCount <= DIMENSION_CARDINALITY_THRESHOLD;
    return lowCardinality ? "dimension" : "text";
  }
  return "text";
}

// ── Join hints (HEL-374 design.md D2) ─────────────────────────────────────
//
// An INDEPENDENT TypeScript implementation of `WorkspaceContextService.computeJoinHints`
// (Scala) — no shared runtime, so parity is achieved by duplicating the rules
// and testing each side separately.

export interface WorkspaceContextJoinHint {
  leftDataTypeId: string;
  leftColumn: string;
  rightDataTypeId: string;
  rightColumn: string;
  confidence: number;
}

/** `computeJoinHints`'s per-name-bucket candidate cap (design.md D2) —
 *  enforced AFTER the `columnStats`-membership candidacy restriction, so
 *  this bounds comparisons, not candidate gathering itself. Matches the
 *  Scala side's `MaxColumnsPerNameBucket`. */
const MAX_COLUMNS_PER_NAME_BUCKET = 50;
/** `computeJoinHints`'s output cap (design.md D2). Matches the Scala side's
 *  `MaxJoinHints`. */
const MAX_JOIN_HINTS = 50;
/** `computeJoinHints`'s confidence-damping floor (design.md D2, post-design-
 *  gate human-review fix) — matches the Scala side's `MinDistinctForFullConfidence`.
 *  See `joinHintConfidence` for the rationale. */
const MIN_DISTINCT_FOR_FULL_CONFIDENCE = 20;

interface JoinCandidate {
  dataTypeId: string;
  columnName: string;
  dataType: string;
  distinctCount: number;
  exampleValues: unknown[];
}

/** Declared-type bucket for join-hint pairing (design.md D2): only columns in
 *  the SAME bucket are ever compared (numeric-ish vs. numeric-ish, string-ish
 *  vs. string-ish, timestamp vs. timestamp) — a cross-type identifier join
 *  (e.g. a string-typed id vs. an integer-typed id) is a stated, accepted
 *  miss, not silently mismatched to a spurious pair. Mirrors the Scala side's
 *  `typeBucket`. */
function typeBucket(dataType: string): string {
  if (dataType === "integer" || dataType === "float") return "numeric";
  if (dataType === "string") return "string";
  if (dataType === "timestamp") return "timestamp";
  if (dataType === "boolean") return "boolean";
  if (CONTENT_DATA_TYPES.has(dataType)) return "content";
  return `unknown:${dataType}`;
}

/** Jaccard overlap of two already-`JSON.stringify`-normalized example-value
 *  sets. Guards its own divide-by-zero explicitly, at the terminal boundary
 *  where the value is computed: an empty-vs-empty pair (e.g. two all-null
 *  identifier columns) yields `0`, not a fabricated `NaN`. Mirrors the Scala
 *  side's `jaccard`. */
function jaccard(left: Set<string>, right: Set<string>): number {
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 0;
  let intersectionSize = 0;
  for (const v of left) if (right.has(v)) intersectionSize += 1;
  return intersectionSize / union.size;
}

/** Confidence for one candidate pair (design.md D2, post-design-gate
 *  human-review fix): `0.5 + 0.5 * jaccard * evidenceWeight`, NOT raw
 *  `0.5 + 0.5 * jaccard`. Raw Jaccard over <=5 example values saturates
 *  trivially — two UNRELATED identifier columns that happen to hold small
 *  sequential integers (`1,2,3,4,5`, an overwhelmingly common shape for
 *  surface ids in small/demo/test data) would otherwise read as
 *  `confidence = 1.0` on pure coincidence. `evidenceWeight` dampens the
 *  value-overlap boost by cardinality evidence, reusing `distinctCount`
 *  (`ColumnStats` already computes it — no new computation, no new fetch): a
 *  column whose sampled `distinctCount` is small can contribute only a
 *  fraction of full evidence weight regardless of how completely its <=5
 *  example values overlap; a well-evidenced identifier column (typically
 *  `distinctCountCapped: true`) reaches `evidenceWeight = 1` quickly, so a
 *  real match can still reach the top of the scale. Rounded via the EXISTING
 *  `roundToFourDecimals` (reused verbatim — safe by inspection here since the
 *  domain is bounded `[0.5, 1.0]`). Mirrors the Scala side's `joinHintConfidence`. */
function joinHintConfidence(left: JoinCandidate, right: JoinCandidate): number {
  const leftValues = new Set(left.exampleValues.map((v) => JSON.stringify(v)));
  const rightValues = new Set(right.exampleValues.map((v) => JSON.stringify(v)));
  const evidenceWeight = Math.min(
    1,
    Math.min(left.distinctCount, right.distinctCount) / MIN_DISTINCT_FOR_FULL_CONFIDENCE,
  );
  return roundToFourDecimals(0.5 + 0.5 * jaccard(leftValues, rightValues) * evidenceWeight);
}

/** Bounded, precision-favoring cross-DataType joinability hints (design.md
 *  D2) — a pure post-processing function over already-built `dataTypes`
 *  entries; no additional fetch. Mirrors the Scala side's `computeJoinHints`.
 *
 *  **Candidate gathering (design-gate round-1 fix, the central cost-bound
 *  requirement)**: a column is a candidate iff its `semanticRole ==
 *  "identifier"` AND its DataType's `columnStats` contains an entry for it —
 *  NOT gathered from `columns`/`t.fields` alone, which is built from the
 *  DataType's entire unbounded declared field list. `columnStats` is
 *  independently capped at `SAMPLE_COLUMN_LIMIT` (40) by
 *  `computeColumnStats`'s own enumeration, so requiring membership in it
 *  genuinely bounds candidates to <=40 per DataType — and, as a side effect,
 *  automatically excludes source-companion DataTypes (whose `columnStats` is
 *  always `{}`) with no separate `pipelineOutput` filter.
 *
 *  Owner-scoping: this function never fetches anything — its only input is
 *  `dataTypes`, the array `buildWorkspaceContext` already assembled for a
 *  SINGLE caller's own `typesPage` (mirrors the Scala side's design.md D3;
 *  there is only ever one caller's data in scope for a given call). */
export function computeJoinHints(
  dataTypes: Array<{
    id: string;
    columns: Array<{ name: string; dataType: string; semanticRole: SemanticRole }>;
    columnStats: Record<string, ColumnStats>;
  }>,
): WorkspaceContextJoinHint[] {
  const candidates: JoinCandidate[] = [];
  for (const dt of dataTypes) {
    for (const c of dt.columns) {
      if (c.semanticRole !== "identifier") continue;
      const stats = dt.columnStats[c.name];
      if (stats === undefined) continue;
      candidates.push({
        dataTypeId: dt.id,
        columnName: c.name,
        dataType: c.dataType,
        distinctCount: stats.distinctCount,
        exampleValues: stats.exampleValues,
      });
    }
  }

  const buckets = new Map<string, JoinCandidate[]>();
  for (const candidate of candidates) {
    const key = normalizedNameTokens(candidate.columnName).join("");
    const bucket = buckets.get(key);
    if (bucket) bucket.push(candidate);
    else buckets.set(key, [candidate]);
  }

  const hints: WorkspaceContextJoinHint[] = [];
  for (const bucket of buckets.values()) {
    const capped = [...bucket]
      .sort((a, b) => {
        const byType = a.dataTypeId.localeCompare(b.dataTypeId);
        return byType !== 0 ? byType : a.columnName.localeCompare(b.columnName);
      })
      .slice(0, MAX_COLUMNS_PER_NAME_BUCKET);

    for (let i = 0; i < capped.length; i++) {
      const a = capped[i];
      if (a === undefined) continue;
      for (let j = i + 1; j < capped.length; j++) {
        const b = capped[j];
        if (b === undefined) continue;
        if (a.dataTypeId === b.dataTypeId) continue;
        if (typeBucket(a.dataType) !== typeBucket(b.dataType)) continue;

        // Canonical (left, right) assignment (design.md D2): the
        // lexicographically smaller dataTypeId is always left — one hint per
        // unordered pair, never two.
        const [left, right] = a.dataTypeId < b.dataTypeId ? [a, b] : [b, a];
        hints.push({
          leftDataTypeId: left.dataTypeId,
          leftColumn: left.columnName,
          rightDataTypeId: right.dataTypeId,
          rightColumn: right.columnName,
          confidence: joinHintConfidence(left, right),
        });
      }
    }
  }

  hints.sort((a, b) => {
    if (a.confidence !== b.confidence) return b.confidence - a.confidence;
    if (a.leftDataTypeId !== b.leftDataTypeId)
      return a.leftDataTypeId.localeCompare(b.leftDataTypeId);
    if (a.leftColumn !== b.leftColumn) return a.leftColumn.localeCompare(b.leftColumn);
    if (a.rightDataTypeId !== b.rightDataTypeId)
      return a.rightDataTypeId.localeCompare(b.rightDataTypeId);
    return a.rightColumn.localeCompare(b.rightColumn);
  });

  return hints.slice(0, MAX_JOIN_HINTS);
}

// ── Token-budget trimming (HEL-377 design.md D1-D9) ──────────────────────
//
// An INDEPENDENT TypeScript implementation of `WorkspaceContextBudget`
// (Scala) — no shared runtime, so parity is achieved by duplicating the
// same tiered shed order (D3) and exact-decomposition technique (D4) and
// testing each side separately (design.md D9). Cross-runtime byte-for-byte
// equality of `estimatedSizeBytes` is NOT claimed (the two serializers can
// escape non-ASCII/control characters differently) — what IS mirrored, and
// IS tested, is the algorithm: the same shed order, reaching the SAME caps
// for an equivalent logical input and budget.

export interface WorkspaceContextTruncation {
  applied: boolean;
  budgetBytes: number;
  estimatedSizeBytes: number;
  sampleRowsCap: number;
  exampleValuesCap: number;
  joinHintsKept: number;
  joinHintsOmittedByBudget: number;
  structuralFloorExceedsBudget: boolean;
  paginationTruncatedResources: string[];
}

/** Env-var-overridable default budget (design.md D8/D9) — same value and
 *  same env-var name as the backend's `WorkspaceContextBudget.DefaultBudgetBytes`,
 *  independently read here since the MCP process has no shared runtime with
 *  the backend. `200000` (~200K UTF-16 code units) if unset or unparseable. */
function readDefaultBudgetBytes(): number {
  const raw = process.env["WORKSPACE_CONTEXT_DEFAULT_BUDGET_BYTES"];
  if (raw === undefined) return 200_000;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : 200_000;
}
export const DEFAULT_BUDGET_BYTES: number = readDefaultBudgetBytes();

/** A discarded placeholder — `buildWorkspaceContext` must supply SOME
 *  `WorkspaceContextTruncation` before `applyBudget` has run (mirrors the
 *  Scala side's `WorkspaceContextBudget.PlaceholderTruncation` — every field
 *  here is overwritten unconditionally by `applyBudget`, never read). */
const PLACEHOLDER_TRUNCATION: WorkspaceContextTruncation = {
  applied: false,
  budgetBytes: 0,
  estimatedSizeBytes: 0,
  sampleRowsCap: 0,
  exampleValuesCap: 0,
  joinHintsKept: 0,
  joinHintsOmittedByBudget: 0,
  structuralFloorExceedsBudget: false,
  paginationTruncatedResources: [],
};

/** D-Pagination (the ticket's carried finding): which of
 *  `dataSources`/`dataTypes`/`dashboards` were truncated by the `limit=200`
 *  fetch (compares each already-fetched page's `items.length` against its
 *  reported `total` — no new request). `[]` when none were truncated. */
export function paginationTruncatedResources(
  sourcesPage: { items: unknown[]; total: number },
  typesPage: { items: unknown[]; total: number },
  dashboardsPage: { items: unknown[]; total: number },
): string[] {
  const result: string[] = [];
  if (sourcesPage.items.length < sourcesPage.total) result.push("dataSources");
  if (typesPage.items.length < typesPage.total) result.push("dataTypes");
  if (dashboardsPage.items.length < dashboardsPage.total) result.push("dashboards");
  return result;
}

type ContextDataTypes = WorkspaceContext["dataTypes"];

/** The CORE context's serialized size — every field of `context` EXCEPT
 *  `truncation` itself (mirrors the Scala side's `coreSize` — excluding
 *  `truncation`'s own bytes avoids a field describing a size that includes
 *  its own not-yet-known serialized length). */
function coreSize(context: WorkspaceContext): number {
  const { truncation: _truncation, ...core } = context;
  return JSON.stringify(core).length;
}

function sampleRowsLenAt(dataTypes: ContextDataTypes, cap: number): number {
  let total = 0;
  for (const dt of dataTypes) total += JSON.stringify(dt.sampleRows.slice(0, cap)).length;
  return total;
}

function exampleValuesLenAt(dataTypes: ContextDataTypes, cap: number): number {
  let total = 0;
  for (const dt of dataTypes) {
    for (const stats of Object.values(dt.columnStats)) {
      total += JSON.stringify(stats.exampleValues.slice(0, cap)).length;
    }
  }
  return total;
}

function joinHintsLenAt(joinHints: WorkspaceContextJoinHint[], cap: number): number {
  return JSON.stringify(joinHints.slice(0, cap)).length;
}

function trimSampleRows(dataTypes: ContextDataTypes, cap: number): ContextDataTypes {
  return dataTypes.map((dt) => ({ ...dt, sampleRows: dt.sampleRows.slice(0, cap) }));
}

function trimExampleValues(dataTypes: ContextDataTypes, cap: number): ContextDataTypes {
  return dataTypes.map((dt) => {
    const columnStats: Record<string, ColumnStats> = {};
    for (const [name, stats] of Object.entries(dt.columnStats)) {
      columnStats[name] = { ...stats, exampleValues: stats.exampleValues.slice(0, cap) };
    }
    return { ...dt, columnStats };
  });
}

/** Searches `maxCap downTo 0` for the LARGEST cap whose predicted total
 *  context size fits `budget` (design.md D4's "table lookup" — an exact
 *  arithmetic identity, never re-serializing the full context per candidate).
 *  `undefined` iff even `c = 0` doesn't fit (the tier is fully exhausted and
 *  still over budget — the caller proceeds to the next tier). */
function findLargestFittingCap(
  maxCap: number,
  currentSize: number,
  naturalTierLen: number,
  tierLenAtCap: (c: number) => number,
  budget: number,
): number | undefined {
  for (let c = maxCap; c >= 0; c--) {
    const predicted = currentSize - (naturalTierLen - tierLenAtCap(c));
    if (predicted <= budget) return c;
  }
  return undefined;
}

/** Applies the D3 tiered shed order to `context`, returning the
 *  (possibly-trimmed) context with its `truncation` field set to the real
 *  outcome. `context.truncation` on entry is discarded unconditionally (see
 *  `PLACEHOLDER_TRUNCATION`) — every other field is read. Pure: no network
 *  calls. Mirrors the Scala side's `WorkspaceContextBudget.apply`. */
export function applyBudget(
  context: WorkspaceContext,
  budgetBytes: number,
  paginationTruncated: string[],
): WorkspaceContext {
  const naturalSampleRowsCap = context.dataTypes.reduce(
    (m, dt) => Math.max(m, dt.sampleRows.length),
    0,
  );
  const naturalExampleValuesCap = context.dataTypes.reduce((m, dt) => {
    let localMax = m;
    for (const stats of Object.values(dt.columnStats))
      localMax = Math.max(localMax, stats.exampleValues.length);
    return localMax;
  }, 0);
  const naturalJoinHintsCount = context.joinHints.length;

  const naturalSize = coreSize(context);

  const truncationOf = (
    applied: boolean,
    estimatedSizeBytes: number,
    sampleRowsCap: number,
    exampleValuesCap: number,
    joinHintsKept: number,
    structuralFloorExceedsBudget: boolean,
  ): WorkspaceContextTruncation => ({
    applied,
    budgetBytes,
    estimatedSizeBytes,
    sampleRowsCap,
    exampleValuesCap,
    joinHintsKept,
    joinHintsOmittedByBudget: naturalJoinHintsCount - joinHintsKept,
    structuralFloorExceedsBudget,
    paginationTruncatedResources: paginationTruncated,
  });

  // Fast path (design.md D4 step 1): one full serialization; if within
  // budget, return unchanged.
  if (naturalSize <= budgetBytes) {
    return {
      ...context,
      truncation: truncationOf(
        false,
        naturalSize,
        naturalSampleRowsCap,
        naturalExampleValuesCap,
        naturalJoinHintsCount,
        false,
      ),
    };
  }

  // ── Tier 1: sampleRows (cut FIRST) ────────────────────────────────────
  const naturalTier1Len = sampleRowsLenAt(context.dataTypes, naturalSampleRowsCap);
  const c1 = findLargestFittingCap(
    naturalSampleRowsCap,
    naturalSize,
    naturalTier1Len,
    (c) => sampleRowsLenAt(context.dataTypes, c),
    budgetBytes,
  );

  if (c1 !== undefined) {
    const estimatedSize = naturalSize - (naturalTier1Len - sampleRowsLenAt(context.dataTypes, c1));
    return {
      ...context,
      dataTypes: trimSampleRows(context.dataTypes, c1),
      truncation: truncationOf(
        true,
        estimatedSize,
        c1,
        naturalExampleValuesCap,
        naturalJoinHintsCount,
        false,
      ),
    };
  }

  // Tier 1 fully exhausted (sampleRows emptied everywhere) and still over
  // budget — proceed to tier 2.
  const sizeAfterTier1 = naturalSize - (naturalTier1Len - sampleRowsLenAt(context.dataTypes, 0));
  const tier1EmptiedTypes = trimSampleRows(context.dataTypes, 0);

  // ── Tier 2: columnStats[*].exampleValues (cut 2nd) ────────────────────
  const naturalTier2Len = exampleValuesLenAt(tier1EmptiedTypes, naturalExampleValuesCap);
  const c2 = findLargestFittingCap(
    naturalExampleValuesCap,
    sizeAfterTier1,
    naturalTier2Len,
    (c) => exampleValuesLenAt(tier1EmptiedTypes, c),
    budgetBytes,
  );

  if (c2 !== undefined) {
    const estimatedSize =
      sizeAfterTier1 - (naturalTier2Len - exampleValuesLenAt(tier1EmptiedTypes, c2));
    return {
      ...context,
      dataTypes: trimExampleValues(tier1EmptiedTypes, c2),
      truncation: truncationOf(true, estimatedSize, 0, c2, naturalJoinHintsCount, false),
    };
  }

  // Tier 2 fully exhausted (exampleValues emptied everywhere) and still over
  // budget — proceed to tier 3.
  const sizeAfterTier2 =
    sizeAfterTier1 - (naturalTier2Len - exampleValuesLenAt(tier1EmptiedTypes, 0));
  const tiers12EmptiedTypes = trimExampleValues(tier1EmptiedTypes, 0);

  // ── Tier 3: joinHints (cut LAST) ───────────────────────────────────────
  const naturalTier3Len = joinHintsLenAt(context.joinHints, naturalJoinHintsCount);
  const c3 = findLargestFittingCap(
    naturalJoinHintsCount,
    sizeAfterTier2,
    naturalTier3Len,
    (c) => joinHintsLenAt(context.joinHints, c),
    budgetBytes,
  );

  if (c3 !== undefined) {
    const estimatedSize =
      sizeAfterTier2 - (naturalTier3Len - joinHintsLenAt(context.joinHints, c3));
    return {
      ...context,
      dataTypes: tiers12EmptiedTypes,
      joinHints: context.joinHints.slice(0, c3),
      truncation: truncationOf(true, estimatedSize, 0, 0, c3, false),
    };
  }

  // D5: structural floor — all three tiers exhausted and STILL over budget.
  // Return as-is at this now-minimal size; resources are never dropped to
  // chase the budget further.
  const estimatedSize = sizeAfterTier2 - (naturalTier3Len - joinHintsLenAt(context.joinHints, 0));
  return {
    ...context,
    dataTypes: tiers12EmptiedTypes,
    joinHints: [],
    truncation: truncationOf(true, estimatedSize, 0, 0, 0, true),
  };
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
    columns: Array<{
      name: string;
      dataType: string;
      nullable: boolean;
      /** HEL-374: deterministic, INFERRED/ADVISORY classification — see
       *  `classifySemanticRole`. Never alters `dataType`, the authoritative
       *  declared type. */
      semanticRole: SemanticRole;
    }>;
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
  /** HEL-549: the caller's defined-metric catalog (HEL-446/493/541) — the semantic layer an agent
   *  should discover and reuse via a proposal panel's `metricId` rather than re-deriving a raw
   *  dataTypeId/fieldMapping binding. Field names mirror `MetricDefinition`/`MetricResponse`
   *  verbatim (`dataTypeId`, not a renamed field). Not paginated/trimmed — mirrors dataSources/
   *  pipelines/dashboards (small, flat records); ALWAYS present (`[]`, never omitted). A
   *  `deprecated: true` entry is still included, not filtered out. */
  metrics: Array<{
    id: string;
    name: string;
    dataTypeId: string;
    measureField: string;
    aggregation: string;
    allowedDimensions: string[];
    format: MetricFormat;
    deprecated: boolean;
  }>;
  /** HEL-374: bounded, precision-favoring, INFERRED/ADVISORY cross-DataType joinability hints —
   *  see `computeJoinHints`. Never authors a join step itself and never mutates any DataType's
   *  authoritative dataType. ALWAYS present (`[]`, never omitted) even when no candidate pairs exist. */
  joinHints: WorkspaceContextJoinHint[];
  /** HEL-377: the deterministic byte-budget outcome — see `applyBudget`. ALWAYS present. */
  truncation: WorkspaceContextTruncation;
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

/** `budgetBytes` (HEL-377 design.md D7/D9): defaults to `DEFAULT_BUDGET_BYTES`
 *  (env-var overridable, same convention as the backend's own default) so
 *  existing callers with a single argument are unaffected. `applyBudget` is
 *  the LAST step before returning — a pure in-memory pass over the
 *  already-bounded structure built above (no new fetch). */
export async function buildWorkspaceContext(
  api: HelioApi,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): Promise<WorkspaceContext> {
  const [sourcesPage, typesPage, dashboardsPage, pipelineSummaries, pipelineShapes, metricsPage] =
    await Promise.all([
      api.listDataSources(),
      api.listDataTypes(),
      api.listDashboards(),
      api.listPipelines(),
      api.listPipelineShapes(),
      api.listMetrics(),
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

  const dataTypes = await Promise.all(
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
          semanticRole: classifySemanticRole(f, columnStats[f.name]),
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
  );

  const context: WorkspaceContext = {
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
    dataTypes,
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
    metrics: metricsPage.items.map((m) => ({
      id: m.id,
      name: m.name,
      dataTypeId: m.dataTypeId,
      measureField: m.measureField,
      aggregation: m.aggregation,
      allowedDimensions: m.allowedDimensions,
      format: m.format,
      deprecated: m.deprecated,
    })),
    // HEL-374 design.md D2/D3: computed once, entirely in-memory, AFTER
    // `dataTypes` above is fully built — no new fetch. `dataTypes` is the
    // exact structure already owner-scoped by `typesPage` (D3), so there is
    // only ever one caller's data in scope for this whole function call.
    joinHints: computeJoinHints(dataTypes),
    // HEL-377: overwritten unconditionally by `applyBudget` below — see
    // `PLACEHOLDER_TRUNCATION`.
    truncation: PLACEHOLDER_TRUNCATION,
  };

  return applyBudget(
    context,
    budgetBytes,
    paginationTruncatedResources(sourcesPage, typesPage, dashboardsPage),
  );
}
