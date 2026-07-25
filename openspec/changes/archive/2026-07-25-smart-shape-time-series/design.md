## Context

HEL-391 (merged, PR #288) landed `PipelineShape`/`Registry`/catalog with `PassthroughShape`. HEL-393
(merged, PR #289) landed `SingleRowShape` (`RowCountContract.ExactlyOne`). HEL-394 (merged, PR #290,
`8c516dff`) landed `TopNShape` (`RowCountContract.AtMostParam`), and settled two conventions this
ticket follows: enum-ish param validation is case-insensitive when it mirrors the underlying step's
own runtime case-insensitivity, and a registry-parity/catalog-naming test pair gets extended, not
duplicated. This ticket is the third concrete shape (`time-series`), the first real consumer of
`RowCountContract.Unbounded`, built on `DateBucketStep` (HEL-378, `backend/.../steps/DateBucketStep.scala`)
+ `AggregateStep` + `SortStep` — no new op, no migration.

## Goals / Non-Goals

**Goals:**
- Register `time-series`: `timeField`/`granularity`/`measures` params → `datebucket` + `aggregate` +
  `sort` expansion, one row per bucket, ordered chronologically.
- Declare `outputContract = OutputContract(RowCountContract.Unbounded, Vector.empty, ...)`.
- Guard the one real correctness hazard specific to this shape: a measure alias colliding with the
  bucket column name.
- Extend the registry-parity test and named-shape catalog HTTP assertion (established two-shape
  precedent from HEL-394).

**Non-Goals:**
- Gap-filling empty time buckets — no fill-null-style op exists on main; filed as a HEL-337 spinoff
  (Decision 5).
- Runtime enforcement that execution actually yields one row per bucket — same declared-not-enforced
  posture as `single-row`'s `ExactlyOne` / `top-n`'s `AtMostParam` (HEL-393 design.md Risk 1).
- Per-source-value gap detection or timezone configurability — `DateBucketStep` is UTC-only and this
  shape doesn't add options `DateBucketStep` itself doesn't support.

## Decisions

**1. Expansion is exactly three steps: `datebucket` (overwrite `timeField` in place), `aggregate`
(`groupBy = [timeField]`, the `measures`), `sort` (ascending on `timeField`).** `datebucket`'s
`outputColumn` is left absent, so the bucketed value overwrites `timeField` in place (confirmed via
`DateBucketStep.apply`: `cfg.outputColumn.filter(_.nonEmpty).getOrElse(field)`) — the ticket's own
phrasing ("groupBy the bucket column") only makes sense if the bucket column *is* `timeField` after
bucketing, and introducing a second `outputColumn` param the ticket never asked for would add
surface area with no requester. *Alternative considered*: expose an optional `outputColumn` to keep
the raw `timeField` alongside the bucketed one — rejected as unrequested scope; `single-row`/`top-n`
both stuck to the literal ticket param list.

**2. A trailing `sort` step (ascending on `timeField`) is always appended, not optional.** Two
independent reasons compound: (a) `AggregateStep.apply` groups via `rows.groupBy(...).toMap`, a hash
map with no ordering guarantee, so bucket order is otherwise implementation-accidental; (b) even if it
were incidentally ordered, `DateBucketStep` writes canonical `yyyy-MM-dd` strings (confirmed in
`DateBucketStep.apply`/`parseToUtcDate`), whose lexicographic order equals chronological order for
every supported granularity, so `SortStep`'s existing string-fallback comparator (`PipelineRowJson.toDouble`
fails to parse a date string, so it falls back to `xs > ys`/`xs < ys` string comparison — see
`SortStep.apply`) sorts correctly with zero new code. Always-append rather than a `sort: Boolean` param
because the ticket's stated purpose ("line/area charts want one row per time bucket ... ordered by
bucket") has no scenario where an unordered time series is useful, and every sibling shape (`top-n`
sorts unconditionally too) treats its core guarantee as non-optional.

**3. `RowCountContract.Unbounded`, not `AtMostParam`.** No params bound the row count — the number of
distinct buckets is purely a function of the source data's date range and `granularity`, unknowable at
`expand`-time. This matches `RowCountContract`'s own scaladoc, which explicitly names "a future
time-series/pivot shape" under the `Unbounded` case. `fields = Vector.empty`: the bucket column's name
(`timeField`) and the measure aliases are both caller-supplied, mirroring `single-row`/`top-n`'s
precedent of leaving `fields` empty whenever the output field set isn't fixed by the shape itself.

**4. `granularity` is validated case-insensitively but normalized to lowercase before being written
into `DateBucketConfig`.** Unlike `AggregateStep.fn` or `SortStep.direction` (both lower/compare
case-insensitively themselves at runtime), `DateBucketStep.floorFn` matches `granularity` via an exact
`case "day" => ... case other => Left(...)` — no `.toLowerCase` anywhere in `DateBucketStep`. Passing
through un-normalized casing (the `top-n`/`single-row` convention for values the underlying step
already lowers itself) would let `expand` return `Right` for `"Day"` and then fail at *execution* time
with "Unsupported granularity: 'Day'" — a validate/execute split worse than either being fully strict
or fully lenient. Normalizing to lowercase here is the one case-handling deviation from the sibling
shapes' pass-through convention, made necessary by `DateBucketStep`'s own stricter behavior (Decision 4
follows the same "validation isn't stricter than the step it guards" principle HEL-394 established —
it just resolves to the opposite normalization strategy here).

**5. Gap-filling is out of scope; filed as a HEL-337 spinoff, not attempted here.** Missing/empty
buckets (e.g. a day with zero source rows produces no output row at all, since `AggregateStep` only
emits groups that exist in the input) is a real product question for line charts, but there is no
fill-null/resample op on main to backfill a bucket with a zero or null measure — same "not trivially
addable, needs its own design gate" posture `top-n` used for per-group top-N (HEL-621). *Alternative
considered*: emit a warning-only `description` note in the output contract instead of a spinoff ticket
— rejected per the ticket's own explicit instruction to "file a spinoff ... rather than leaving it
unstated."

**6. Reject any measure `alias` equal to `timeField`.** `AggregateStep.apply` builds
`keyMap ++ aggMap`, where `keyMap` carries the groupBy value (the bucket) and `aggMap` carries the
aggregation results keyed by `alias`. Map union favors the right-hand side, so an alias colliding with
`timeField` would silently replace the bucket value with the aggregation result, breaking "one row per
bucket, columns = bucket + measures" without any runtime error. Neither `single-row` (`groupBy` is
always empty) nor `top-n` (no aliasing at all) had this hazard, so it's new validation specific to this
shape rather than something a sibling's precedent would have caught.

## Risks / Trade-offs

- **[Risk]** A caller who wants the raw, unbucketed `timeField` preserved alongside the bucketed
  column has no way to ask for that (Decision 1 always overwrites in place). → **Mitigation**:
  out of ticket scope; `datebucket`'s own `outputColumn` param remains available for hand-built
  pipelines that need both.
- **[Risk]** `Unbounded` gives a caller (panel binding, HEL-399) no compile-time bound on row count for
  a wide date range with fine granularity (e.g. `day` over years of data). → **Mitigation**: same
  posture as `passthrough`'s `Unbounded`; nothing in this shape makes that worse than a hand-built
  `datebucket` + `aggregate` pipeline would already be.
- **[Risk]** Silent zero-row buckets (Decision 5) could visually read as "flat line at zero" vs. "no
  data" ambiguity once panels bind to this shape. → **Mitigation**: explicitly deferred, spinoff filed,
  not silently absorbed into this ticket's scope.

## Planner Notes

- Self-approved: normalizing `granularity` casing (Decision 4) rather than passing it through
  unchanged — required by `DateBucketStep`'s own case-sensitive matching; not a new dependency or
  scope expansion, just correctness.
- Self-approved: the alias/`timeField` collision guard (Decision 6) — a genuine correctness gap the
  ticket's step list implies but doesn't spell out; single-file, contained, no new dependency.
- Self-approved: filing the gap-filling spinoff (Decision 5) rather than escalating — the ticket
  explicitly pre-authorizes exactly this disposition ("Out of scope... leave to fill-null / a
  follow-up").
