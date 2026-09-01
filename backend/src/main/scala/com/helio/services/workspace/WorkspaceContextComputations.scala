package com.helio.services.workspace

import com.helio.api.protocols.workspace.{WorkspaceContextColumn, WorkspaceContextColumnStats, WorkspaceContextJoinHint, WorkspaceContextOutput}
import com.helio.domain.model.{DataField, DataFieldType, FieldTypeCategory}
import spray.json.{JsNull, JsNumber, JsObject, JsString, JsValue}

import scala.math.BigDecimal.RoundingMode

/** Pure, resource-scoped computation helpers for `WorkspaceContextService` --
 *  split out of that file (HEL-907 task 1.7) purely for file-size budget
 *  (`scripts/check-scala-quality.mjs`'s soft 250-line threshold; the combined
 *  file was 923 lines). This is a MECHANICAL move, not a rewrite: every
 *  method/constant below is relocated VERBATIM (identical body, identical
 *  constant value, identical `private`/`private[services]` visibility) from
 *  `WorkspaceContextService.scala` -- see this ticket's design.md caution:
 *  "do not alter `asNumeric`'s filter structure or `BigDecimal.setScale`
 *  rounding" (HEL-373's hard-won single-exit-point finiteness filter and
 *  overflow-safe rounding technique, each fixed only after multiple
 *  design-gate rounds -- see `asNumeric`'s own doc comment below for the
 *  full history). `WorkspaceContextService` mixes this trait in
 *  (`extends WorkspaceContextComputations`) so every existing call site
 *  (`service.classifySemanticRole(...)`, `service.computeColumnStats(...)`,
 *  `service.asNumeric(...)`, etc. -- including every existing test spec)
 *  keeps working completely unchanged: an inherited trait member is still an
 *  ordinary instance method on the concrete class. `SampleColumnLimit` is
 *  the one constant genuinely shared across this trait and
 *  `WorkspaceContextService`'s own remaining `toDataTypeEntry` (which builds
 *  the SQL-tier `excludeKeys` bound using the same cap this trait's
 *  `sanitizeSampleRows`/`computeColumnStats` re-enforce client-side) -- it
 *  lives here now, referenced by the main class via ordinary inheritance
 *  (`this.SampleColumnLimit`, unqualified), the same as any other inherited
 *  member; no self-type or abstract-member machinery was needed since
 *  nothing in THIS trait needs anything unique to the concrete class. */
trait WorkspaceContextComputations {

  /** Bounded sample-row count per pipeline-output DataType (design.md D1/D3)
   *  — a documented constant, never unbounded; `DataTypeRowRepository.listRows`
   *  enforces this at the SQL tier via `LIMIT`. `sampleRows` is derived from
   *  the first `SampleRowLimit` of the shared `StatsRowLimit`-wide fetch
   *  below (HEL-373 design.md D1) — its own wire output is unchanged. */
  private val SampleRowLimit: Int = 5

  /** First N declared Structured-category columns retained per sample row
   *  and per `columnStats` (design.md D3/D2 round-3 fix) — enforced BOTH at
   *  the SQL tier (`excludeKeys` extension below) and independently by
   *  `computeColumnStats`'s own column enumeration (design.md D2). */
  protected val SampleColumnLimit: Int = 40

  /** Per-cell character cap before truncation (design.md D3). */
  private val SampleCellCharLimit: Int = 200

  private val TruncationMarker: String = "…[truncated]"

  /** `distinctCount` stops distinguishing beyond this cap (design.md D4);
   *  `distinctCountCapped: true` reports "at least this many, exact count not
   *  computed beyond the cap." */
  private val DistinctCountCap: Int = 100

  /** Max `exampleValues` entries per column (design.md D6). */
  private val ExampleValueLimit: Int = 5

  /** `mean`'s fixed rounding precision — 4 decimal places (design.md D5/D6
   *  determinism). Round-3 fix: applied via `BigDecimal.setScale`, not a
   *  multiply-by-`10^scale`-then-`math.round` factor (see
   *  `computeColumnStatsForField`'s round-3-fix comment for why the latter
   *  technique is itself an overflow surface). */
  private val MeanRoundingScale: Int = 4

  /** `classifySemanticRole`'s string→dimension cardinality ceiling (HEL-374
   *  design.md D1 step 7) — a string column with `distinctCount` at or below
   *  this (and real evidence, and not `distinctCountCapped`) is classified
   *  `dimension` rather than `text`. Self-approved tunable, no existing
   *  codebase precedent (design.md Planner Notes). */
  private val DimensionCardinalityThreshold: Int = 50

  /** `computeJoinHints`'s per-name-bucket candidate cap (HEL-374 design.md
   *  D2) — enforced AFTER the `columnStats`-membership candidacy restriction,
   *  so this bounds comparisons, not candidate gathering itself. Stable-sorted
   *  by `(dataTypeId, column)` before truncation (deterministic). Self-approved
   *  tunable, no existing codebase precedent. */
  private val MaxColumnsPerNameBucket: Int = 50

  /** `computeJoinHints`'s output cap (HEL-374 design.md D2) — sorted by
   *  confidence descending, `(leftDataTypeId, leftColumn, rightDataTypeId,
   *  rightColumn)` ascending tie-break, before truncation. Self-approved
   *  tunable, no existing codebase precedent. */
  private val MaxJoinHints: Int = 50

  /** `computeJoinHints`'s confidence-damping floor (HEL-374 design.md D2,
   *  post-design-gate human-review fix): a pair's `evidenceWeight` reaches
   *  `1.0` once BOTH sides' `distinctCount` is at or above this — below it,
   *  `evidenceWeight` scales down linearly, damping the value-overlap boost
   *  so two unrelated low-cardinality identifier columns that coincidentally
   *  share the same small example-value set (e.g. sequential integers
   *  `1..5`, common in small/demo data) cannot read as near-certain. Self-
   *  approved tunable, no existing codebase precedent. */
  private val MinDistinctForFullConfidence: Int = 20

  protected def contentFieldNames(fields: Vector[DataField]): Set[String] =
    fields.filter(f => fieldCategory(f) == FieldTypeCategory.Content).map(_.name).toSet

  /** HEL-904 task 3.12: inlined verbatim from the now-decoupled
   *  `DataTypeService.overflowStructuredFieldNames` (a pure function, no DataType-repository
   *  dependency) so this file no longer needs a `DataTypeService` collaborator at all. */
  protected def overflowStructuredFieldNames(fields: Vector[DataField], limit: Int): Set[String] =
    fields
      .filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured))
      .drop(limit)
      .map(_.name)
      .toSet

  /** A field whose `dataType` string doesn't parse via `DataFieldType.fromString`
   *  is conservatively excluded from both categories (never Structured, so
   *  never sampled) — design.md D3. */
  private def fieldCategory(f: DataField): Option[FieldTypeCategory] =
    DataFieldType.fromString(f.dataType).map(DataFieldType.category)

  private val TemporalNameTokens: Set[String]   = Set("date", "time", "timestamp", "dob")
  private val IdentifierNameTokens: Set[String] = Set("id", "uuid", "guid")

  /** Name-token normalization (HEL-374 design.md D1 steps 4/5): camelCase
   *  boundary insertion (`fooBar` → `foo_Bar`), lowercase, split on `_`. The
   *  ONE shared implementation for BOTH the temporal-token check (step 4) and
   *  the identifier-token check (step 5) — token-exact matching throughout,
   *  never substring (a raw `.contains("date")`/`.contains("guid")` would
   *  misclassify `validated`/`estimated`/`guidance`/`guideline`/`misguided`;
   *  design-gate round-1 finding, closed in round 2). Also reused verbatim by
   *  `computeJoinHints`'s name-bucket grouping key (design.md D2) — one
   *  normalization helper, not a forked copy, so the two can never drift.
   *  `private[services]` so this can be unit-tested directly (tasks.md 2.1). */
  private[services] def normalizedNameTokens(name: String): Vector[String] = {
    val snakeCase = name.replaceAll("([a-z0-9])([A-Z])", "$1_$2").toLowerCase
    snakeCase.split("_").toVector.filter(_.nonEmpty)
  }

  private def isTemporalName(tokens: Vector[String]): Boolean =
    tokens.exists(TemporalNameTokens.contains) || (tokens.size > 1 && tokens.last == "at")

  private def isIdentifierName(tokens: Vector[String]): Boolean =
    tokens.exists(IdentifierNameTokens.contains)

  /** Deterministic `semanticRole` classification (HEL-374 design.md D1),
   *  first-match-wins, 8-step precedence:
   *   1. Content-category field → `text` (carried finding #6 — content values
   *      are never inspected; this is a name/category-only, unconditional
   *      short-circuit, checked BEFORE any name heuristic so a Content field
   *      can never be misclassified `temporal`/`identifier` by its name).
   *   2. Declared `boolean` → `boolean`.
   *   3. Declared `timestamp` → `temporal`.
   *   4. Name matches the temporal-token heuristic → `temporal`.
   *   5. Name matches the identifier-token heuristic → `identifier`.
   *   6. Declared `integer`/`float` → `measure`.
   *   7. Declared `string` with real evidence (`distinctCount > 0`, excludes
   *      the all-empty-snapshot case from being misread as "confirmed low
   *      cardinality"), not `distinctCountCapped`, and `distinctCount <=
   *      DimensionCardinalityThreshold` → `dimension`; otherwise → `text`.
   *   8. Unparseable `dataType` (falls through every declared-type check
   *      above) → `text`.
   *  `private[services]` so `WorkspaceContextServiceSpec` (or a dedicated
   *  spec) can table-drive this directly (tasks.md 5.1). */
  private[services] def classifySemanticRole(field: DataField, stats: Option[WorkspaceContextColumnStats]): String = {
    val declaredType = DataFieldType.fromString(field.dataType)
    val tokens        = normalizedNameTokens(field.name)

    if (fieldCategory(field).contains(FieldTypeCategory.Content)) "text"
    else if (declaredType.contains(DataFieldType.BooleanType)) "boolean"
    else if (declaredType.contains(DataFieldType.TimestampType)) "temporal"
    else if (isTemporalName(tokens)) "temporal"
    else if (isIdentifierName(tokens)) "identifier"
    else if (declaredType.contains(DataFieldType.IntegerType) || declaredType.contains(DataFieldType.FloatType)) "measure"
    else if (declaredType.contains(DataFieldType.StringType)) {
      val lowCardinality = stats.exists(s =>
        s.distinctCount > 0 && !s.distinctCountCapped && s.distinctCount <= DimensionCardinalityThreshold
      )
      if (lowCardinality) "dimension" else "text"
    } else "text" // unparseable dataType (step 8)
  }

  /** Pure, unit-testable sanitizer (design.md D3, tasks.md 2.1/4.2):
   *   1. Column projection — keep only `Structured`-category fields (a field
   *      whose `dataType` doesn't parse is conservatively excluded), take the
   *      first `SampleColumnLimit` of those in `fields`' declared order.
   *   2. Row projection — the first `SampleRowLimit` rows (defense-in-depth;
   *      the SQL-tier `LIMIT` already bounds this in the real call path, but
   *      this keeps the function safe to call directly with an oversized
   *      `rawRows` in a unit test).
   *   3. Cell truncation — any retained cell whose `compactPrint.length > 200`
   *      is replaced with `JsString(compactPrint.take(200) + "…[truncated]")`,
   *      applied uniformly regardless of the value's original JSON type.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case. */
  private[services] def sanitizeSampleRows(fields: Vector[DataField], rawRows: Vector[JsObject]): Vector[JsObject] = {
    val structuredFieldNames: Vector[String] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit).map(_.name)

    rawRows.take(SampleRowLimit).map { row =>
      val projected = structuredFieldNames.flatMap(name => row.fields.get(name).map(name -> truncateCell(_)))
      JsObject(projected.toMap)
    }
  }

  private def truncateCell(v: JsValue): JsValue = {
    val compact = v.compactPrint
    if (compact.length > SampleCellCharLimit)
      JsString(compact.take(SampleCellCharLimit) + TruncationMarker)
    else v
  }

  /** Per-column fold accumulator for `computeColumnStats` — not part of the
   *  wire shape, purely an internal aggregation helper. `distinctSeen` is
   *  unordered and capped at `DistinctCountCap + 1` (101) entries (design.md
   *  D4 — order doesn't matter for a count); `exampleValues`/`exampleKeysSeen`
   *  are the order-preserving, separately-capped-at-5 sibling (design.md D6).
   */
  private final case class ColumnFold(
      nullCount: Int = 0,
      distinctSeen: Set[String] = Set.empty,
      exampleValues: Vector[JsValue] = Vector.empty,
      exampleKeysSeen: Set[String] = Set.empty,
      numericCount: Int = 0,
      numericSum: Double = 0.0,
      numericMin: Double = Double.PositiveInfinity,
      numericMax: Double = Double.NegativeInfinity
  )

  /** `computeColumnStats`'s direct sibling to `sanitizeSampleRows` (design.md
   *  D1/D2/D3/D4/D5/D6/D8, tasks.md 3.1). **Column enumeration**: filters
   *  `fields` to Structured-category and takes the first `SampleColumnLimit`
   *  (40) in declared order — REQUIRED and independent of the SQL-tier
   *  `excludeKeys` bound applied to the fetch itself (design.md D2 round-3
   *  fix: the SQL-tier bound only stops Postgres from sending overflow-column
   *  *values*; it does nothing to stop this enumeration from still producing
   *  an entry per overflow column name if not filtered here too).
   *
   *  Produces one entry per (capped) Structured-category column even when
   *  `rawRows` is empty (design.md D8) — `nullRate: 0` (not `NaN`),
   *  `distinctCount: 0`, `distinctCountCapped: false`, `exampleValues: []`,
   *  no `min`/`max`/`mean` in that case.
   *
   *  `private[services]` (not `private`) so `WorkspaceContextServiceSpec` can
   *  unit-test it directly without a DB fixture per case, mirroring
   *  `sanitizeSampleRows`. */
  private[services] def computeColumnStats(
      fields: Vector[DataField],
      rawRows: Vector[JsObject]
  ): Map[String, WorkspaceContextColumnStats] = {
    val structuredFields: Vector[DataField] =
      fields.filter(f => fieldCategory(f).contains(FieldTypeCategory.Structured)).take(SampleColumnLimit)

    structuredFields.map(field => field.name -> computeColumnStatsForField(field, rawRows)).toMap
  }

  private def computeColumnStatsForField(field: DataField, rawRows: Vector[JsObject]): WorkspaceContextColumnStats = {
    val isNumericField = DataFieldType.fromString(field.dataType) match {
      case Some(DataFieldType.IntegerType) | Some(DataFieldType.FloatType) => true
      case _                                                               => false
    }
    val totalRows = rawRows.size

    val fold = rawRows.foldLeft(ColumnFold()) { (acc, row) =>
      row.fields.get(field.name) match {
        case None | Some(JsNull) =>
          acc.copy(nullCount = acc.nullCount + 1)
        case Some(v) =>
          val truncated    = truncateCell(v)
          val truncatedKey = truncated.compactPrint

          // Distinct-count set: stops growing once already past the cap
          // (design.md D4 — never allowed past 101 entries).
          val withDistinct =
            if (acc.distinctSeen.size > DistinctCountCap || acc.distinctSeen.contains(truncatedKey)) acc
            else acc.copy(distinctSeen = acc.distinctSeen + truncatedKey)

          // Example values: first 5 distinct, truncated, non-null values in
          // row order (design.md D6 determinism).
          val withExamples =
            if (withDistinct.exampleValues.size >= ExampleValueLimit || withDistinct.exampleKeysSeen.contains(truncatedKey))
              withDistinct
            else
              withDistinct.copy(
                exampleValues   = withDistinct.exampleValues :+ truncated,
                exampleKeysSeen = withDistinct.exampleKeysSeen + truncatedKey
              )

          if (isNumericField)
            asNumeric(v) match {
              case Some(n) =>
                withExamples.copy(
                  numericCount = withExamples.numericCount + 1,
                  numericSum   = withExamples.numericSum + n,
                  numericMin   = math.min(withExamples.numericMin, n),
                  numericMax   = math.max(withExamples.numericMax, n)
                )
              case None => withExamples
            }
          else withExamples
      }
    }

    val distinctCountCapped = fold.distinctSeen.size > DistinctCountCap
    val distinctCount       = math.min(fold.distinctSeen.size, DistinctCountCap)
    val nullRate            = if (totalRows == 0) 0.0 else fold.nullCount.toDouble / totalRows

    // `rawMean` is deliberately left UNROUNDED here — see the rounding
    // technique note below for why.
    val (min, max, rawMean) =
      if (fold.numericCount > 0)
        (Some(fold.numericMin), Some(fold.numericMax), Some(fold.numericSum / fold.numericCount))
      else (None, None, None)

    // HEL-373 skeptic-final-3.md, human-mandated placement: the terminal
    // boundary before a WorkspaceContextColumnStats is built and serialized —
    // the ONE place a "no non-finite min/max/mean" invariant can be enforced
    // totally, regardless of whether the non-finite value originated from a
    // per-value parse (asNumeric, already airtight per rounds 1-2) or from
    // aggregation itself (e.g. `fold.numericSum` overflowing Double to
    // Infinity across many individually-finite values, round 3's finding —
    // `min`/`max` cannot overflow the same way since they're `math.min`/
    // `math.max` over already-finite operands, but are guarded here too so
    // the invariant covers all three fields uniformly rather than depending
    // on today's arithmetic happening not to overflow). INVARIANT: no
    // WorkspaceContextColumnStats may ever be constructed containing a
    // non-finite min/max/mean — a non-finite value is excluded (`None`), same
    // "excluded, not fabricated, not zero" semantics asNumeric already
    // established for individual values.
    //
    // Rounding technique (round-3 fix, replaces design.md D5's originally
    // literal `math.round(sum/count * 10000) / 10000.0`): that technique's
    // OWN multiply-by-10000 step is a second, independent overflow surface —
    // `math.round` on a Double **at or beyond `Long.MaxValue` in magnitude**
    // (not just actual `Infinity`) silently CLAMPS to `Long.MaxValue` rather
    // than erroring (confirmed by direct probe: `math.round(1e308)` ==
    // `Long.MaxValue`), so a genuinely large-but-finite mean (e.g. one
    // enormous-but-legitimate outlier value averaged with 499 ordinary rows)
    // would silently fabricate the identical wrong ~922-trillion value this
    // whole ticket has been about eliminating — even though `rawMean` itself
    // is finite and mathematically correct. `BigDecimal.setScale` avoids this
    // entirely: it rounds to 4 decimal places without ever multiplying the
    // value's own magnitude, so a legitimately huge finite mean survives
    // correctly (its 4-decimals-place rounding is a practical no-op at that
    // magnitude, which is expected — not a defect). The final `.isFinite`
    // check (defense in depth) still excludes the vanishingly rare case where
    // `.toDouble`'s own BigDecimal→Double conversion overflows.
    WorkspaceContextColumnStats(
      nullRate             = nullRate,
      distinctCount        = distinctCount,
      distinctCountCapped  = distinctCountCapped,
      exampleValues        = fold.exampleValues,
      min                  = min.filter(_.isFinite),
      max                  = max.filter(_.isFinite),
      mean                 = rawMean.filter(_.isFinite).map(roundToFourDecimals).filter(_.isFinite)
    )
  }

  /** Rounds `v` to 4 decimal places via `BigDecimal.setScale` (design.md D5's
   *  "4 decimal places" requirement) without the intermediate
   *  multiply-then-`math.round`-as-`Long` overflow surface — see the
   *  round-3-fix comment at `computeColumnStatsForField`'s call site. Callers
   *  are responsible for ensuring `v` is already finite (this function does
   *  not itself guard non-finite input — `BigDecimal(Double.PositiveInfinity)`
   *  throws, so callers must filter first, which `computeColumnStatsForField`
   *  already does). */
  private def roundToFourDecimals(v: Double): Double =
    BigDecimal(v).setScale(MeanRoundingScale, RoundingMode.HALF_UP).toDouble

  /** Numeric parsing (design.md D5): `JsNumber` directly; `JsString(s)` via
   *  `s.trim.toDoubleOption` (CSV sources read numeric-declared columns as
   *  strings at runtime); everything else (boolean/object/array/unparseable
   *  string) is `None` — excluded from `min`/`max`/`mean`, NOT counted as
   *  null, NOT treated as `0`.
   *
   *  **Single exit-point finiteness filter (HEL-373 skeptic-final-2.md,
   *  human-mandated restructure after skeptic-final-1.md's per-branch patch
   *  missed a sibling instance of the same bug)**: `.filter(_.isFinite)` is
   *  applied ONCE, to the whole match's result, not per-branch. Why: a
   *  large-magnitude numeric JSON literal can overflow to `±Infinity` on
   *  conversion to `Double` regardless of which branch produced the
   *  candidate — `JsNumber`'s `BigDecimal.toDouble` overflows for a
   *  sufficiently large magnitude (e.g. `1e400`) even though `BigDecimal`
   *  itself is always finite/arbitrary-precision, and `JsString`'s
   *  `toDoubleOption` accepts the literal strings `"NaN"`/`"Infinity"`/
   *  `"-Infinity"` as successfully-parsed non-finite doubles. Either path
   *  would otherwise poison `mean` via `math.round` (`NaN` → `0L`,
   *  `Infinity` → `Long.MaxValue`) and make `min`/`max` silently
   *  wire-serialize to `null` via a `Some(NaN)`/`Some(Infinity)` — a
   *  different, unhandled failure mode from the documented `None`-omission
   *  behavior. Filtering once at the exit makes the function structurally
   *  incapable of returning a non-finite value regardless of which branch
   *  produced it, and any future branch added here inherits the guarantee
   *  automatically — the fix is at the contract's boundary, not duplicated
   *  per-branch.
   *
   *  `private[services]` so `WorkspaceContextServiceSpec` can unit-test it
   *  directly. */
  private[services] def asNumeric(v: JsValue): Option[Double] = (v match {
    case JsNumber(n) => Some(n.toDouble)
    case JsString(s) => s.trim.toDoubleOption
    case _           => None
  }).filter(_.isFinite)

  /** One join-hint candidate: an `identifier`-role column that also has a
   *  `columnStats` entry (HEL-374 design.md D2's round-1-fix candidacy
   *  restriction — see `computeJoinHints`), paired with the owning
   *  DataType's id and the `columnStats` needed for the confidence
   *  computation. Not part of the wire shape, purely an internal grouping
   *  helper. */
  private final case class JoinCandidate(dataTypeId: String, column: WorkspaceContextColumn, stats: WorkspaceContextColumnStats)

  /** Declared-type bucket for join-hint pairing (design.md D2): only columns
   *  in the SAME bucket are ever compared (numeric-ish vs. numeric-ish,
   *  string-ish vs. string-ish, timestamp vs. timestamp) — a cross-type
   *  identifier join (e.g. a string-typed id vs. an integer-typed id) is a
   *  stated, accepted miss (design.md Risks), not silently mismatched to a
   *  spurious pair. An unparseable `dataType` buckets with its own literal
   *  string, so two columns with the same unrecognized `dataType` can still
   *  pair, but never with a recognized type. */
  private def typeBucket(dataType: String): String = DataFieldType.fromString(dataType) match {
    case Some(DataFieldType.IntegerType) | Some(DataFieldType.FloatType)         => "numeric"
    case Some(DataFieldType.StringType)                                         => "string"
    case Some(DataFieldType.TimestampType)                                      => "timestamp"
    case Some(DataFieldType.BooleanType)                                        => "boolean"
    case Some(DataFieldType.StringBodyType) | Some(DataFieldType.BinaryRefType) => "content"
    case None                                                                   => s"unknown:$dataType"
  }

  /** Jaccard overlap of two already-truncated `compactPrint` example-value
   *  sets (design.md D2). Guards its own divide-by-zero explicitly, at the
   *  terminal boundary where the value is computed (carried finding #3 — ask
   *  what happens on the empty-vs-empty case before writing the guard, not
   *  just at it): an empty-vs-empty pair (e.g. two all-null identifier
   *  columns) yields `0.0`, not a fabricated `NaN`. */
  private def jaccard(left: Set[String], right: Set[String]): Double = {
    val union = left ++ right
    if (union.isEmpty) 0.0 else (left intersect right).size.toDouble / union.size.toDouble
  }

  /** Confidence for one candidate pair (HEL-374 design.md D2, post-design-gate
   *  human-review fix): `0.5 + 0.5 * jaccard * evidenceWeight`, NOT raw
   *  `0.5 + 0.5 * jaccard`. Raw Jaccard over ≤5 example values saturates
   *  trivially — two UNRELATED identifier columns that happen to hold small
   *  sequential integers (`1,2,3,4,5`, an overwhelmingly common shape for
   *  surface ids in small/demo/test data) would otherwise read as
   *  `confidence = 1.0` on pure coincidence. `evidenceWeight` dampens the
   *  value-overlap boost by cardinality evidence, reusing `distinctCount`
   *  (`columnStats` already computes it — no new computation, no new fetch):
   *  a column whose sampled `distinctCount` is small can contribute only a
   *  fraction of full evidence weight regardless of how completely its
   *  ≤5 example values overlap; a well-evidenced identifier column (typically
   *  `distinctCountCapped: true`) reaches `evidenceWeight = 1.0` quickly, so a
   *  real match can still reach the top of the scale. Rounded via the
   *  EXISTING `roundToFourDecimals` (reused verbatim, per carried finding #1
   *  — safe by inspection here since the domain is bounded `[0.5, 1.0]`). */
  private def joinHintConfidence(left: JoinCandidate, right: JoinCandidate): Double = {
    val leftValues  = left.stats.exampleValues.map(_.compactPrint).toSet
    val rightValues = right.stats.exampleValues.map(_.compactPrint).toSet
    val evidenceWeight =
      math.min(1.0, math.min(left.stats.distinctCount, right.stats.distinctCount).toDouble / MinDistinctForFullConfidence)
    roundToFourDecimals(0.5 + 0.5 * jaccard(leftValues, rightValues) * evidenceWeight)
  }

  /** Bounded, precision-favoring cross-DataType joinability hints (HEL-374
   *  design.md D2) — a pure post-processing step over `dataTypes`, the exact
   *  structures `assemble` already built; no new DB access, no new `Future`
   *  step (wired once, after the `Future.traverse` that builds `dataTypes`
   *  completes — design.md D3).
   *
   *  **Candidate gathering (design-gate round-1 fix, the central cost-bound
   *  requirement)**: a column is a candidate iff its `semanticRole ==
   *  "identifier"` AND its DataType's `columnStats` contains an entry for it
   *  — NOT gathered from `columns` alone, which is built from the DataType's
   *  entire unbounded declared field list. `columnStats` is independently
   *  capped at `SampleColumnLimit` (40) by `computeColumnStats`'s own
   *  enumeration, so requiring membership in it genuinely bounds candidates
   *  to ≤40 per DataType (verified by construction, not assumed) — and, as a
   *  side effect, automatically excludes source-companion DataTypes (whose
   *  `columnStats` is always empty) with no separate `pipelineOutput` filter,
   *  and guarantees every candidate has `exampleValues` available for the
   *  confidence computation.
   *
   *  **Bounding the comparison work**: candidates are grouped by normalized
   *  name (`normalizedNameTokens`, reused verbatim from the semantic-role
   *  name heuristic — one implementation, not a forked copy); each bucket is
   *  capped at `MaxColumnsPerNameBucket`, stable-sorted by `(dataTypeId,
   *  column name)` before truncation (deterministic, not iteration-order-
   *  dependent). Only cross-DataType, same-declared-type-bucket pairs are
   *  compared. Worst case: `Page.Default` (200) DataTypes × `SampleColumnLimit`
   *  (40) candidates each = 8,000 candidate columns; each compared against at
   *  most `MaxColumnsPerNameBucket - 1` (49) same-bucket peers ⇒ ≤ 392,000
   *  pairwise comparisons, each an O(1)-ish Jaccard over ≤5-element sets — no
   *  DB I/O, sub-second CPU, independent of how many buckets exist.
   *
   *  `private[services]` so this can be pure-unit-tested directly (tasks.md
   *  5.2), mirroring `sanitizeSampleRows`/`computeColumnStats`. */
  private[services] def computeJoinHints(dataTypes: Vector[WorkspaceContextOutput]): Vector[WorkspaceContextJoinHint] = {
    val candidates: Vector[JoinCandidate] = dataTypes.flatMap { dt =>
      dt.columns
        .filter(c => c.semanticRole == "identifier" && dt.columnStats.contains(c.name))
        .map(c => JoinCandidate(dt.id, c, dt.columnStats(c.name)))
    }

    val buckets: Map[String, Vector[JoinCandidate]] =
      candidates.groupBy(c => normalizedNameTokens(c.column.name).mkString(""))

    val hints: Vector[WorkspaceContextJoinHint] = buckets.values.flatMap { bucket =>
      val capped = bucket.sortBy(c => (c.dataTypeId, c.column.name)).take(MaxColumnsPerNameBucket)
      for {
        i <- capped.indices
        j <- (i + 1) until capped.size
        a  = capped(i)
        b  = capped(j)
        if a.dataTypeId != b.dataTypeId
        if typeBucket(a.column.dataType) == typeBucket(b.column.dataType)
      } yield {
        // Canonical (left, right) assignment (design.md D2): the
        // lexicographically smaller dataTypeId is always left — one hint per
        // unordered pair, never two.
        val (left, right) = if (a.dataTypeId < b.dataTypeId) (a, b) else (b, a)
        WorkspaceContextJoinHint(
          leftDataTypeId  = left.dataTypeId,
          leftColumn      = left.column.name,
          rightDataTypeId = right.dataTypeId,
          rightColumn     = right.column.name,
          confidence      = joinHintConfidence(left, right)
        )
      }
    }.toVector

    hints
      .sortBy(h => (-h.confidence, h.leftDataTypeId, h.leftColumn, h.rightDataTypeId, h.rightColumn))
      .take(MaxJoinHints)
  }


}
