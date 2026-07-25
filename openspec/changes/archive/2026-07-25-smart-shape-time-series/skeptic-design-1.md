## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket / proposal / design / spec-delta / tasks read in full** — no `TODO`/`TBD`/hand-waving,
  internal contradictions, or ambiguity found across the artifacts.

- **`DateBucketStep.scala`**: `DateBucketStep.apply` — `val outputCol = cfg.outputColumn.filter(_.nonEmpty).getOrElse(field)`
  confirms overwrite-in-place when `outputColumn` is absent (design.md Decision 1, accurate). `floorFn`
  matches granularity via an exact `case "day" => ... case other => Left(...)` with **no `.toLowerCase`
  anywhere in the file** — confirms Decision 4's case-sensitivity claim and the need for `expand`-side
  lowercase normalization.

- **`OutputContract.scala`**: `RowCountContract`'s scaladoc literally reads `Unbounded: row count is
  data-dependent (e.g. a future time-series/pivot shape, or this ticket's passthrough reference shape)`
  — design.md Decision 3's claim that the scaladoc "explicitly names a future time-series/pivot shape"
  is verbatim-accurate, not asserted.

- **`AggregateStep.scala`**: `apply` builds `keyMap ++ aggMap` (`keyMap` = groupBy value, `aggMap` =
  alias→aggregation result); Scala's right-biased `Map ++` means a colliding key in `aggMap` silently
  overwrites `keyMap`'s value — confirms the alias/`timeField` collision hazard (Decision 6) is real,
  not hypothetical.

- **`SortStep.scala`** + **`PipelineRowJson.scala`**: `toDouble` returns `None` for a `String` unless
  `s.toDoubleOption` succeeds — an ISO `yyyy-MM-dd` string fails that parse, so `SortStep.apply` falls
  back to `xs > ys`/`xs < ys` raw string comparison, which is lexicographically == chronologically
  correct for `yyyy-MM-dd`. Confirms Decision 2's zero-new-code sort-correctness claim.
  `AggregateStep.apply` groups via `rows.groupBy(...)` into a `Map`, giving no ordering guarantee —
  confirms the always-append-sort justification.

- **`PipelineShape.scala`, `TopNShape.scala`, `SingleRowShape.scala`, `ShapeStepExpansion.scala`**: the
  planned `TimeSeriesShape` shape follows the same trait contract, `Registry` pattern, and
  wire-shape-reuse conventions (`Aggregation`'s `{fn,field,alias}` shape) as the two precedent shapes.

- **`openspec/specs/pipeline-shape-registry/spec.md` (merged) vs. the change's spec delta**: both
  `MODIFIED Requirements` blocks (`PipelineShape.Registry enumerates every registered shape` and
  `GET /api/pipeline-shapes returns the shape catalog`) are full, faithful reproductions of the current
  merged text, with only the targeted id-set/size/scenario line updated to add `"time-series"` — not
  partial rewrites that would lose detail at archive time.

- **`schemas/pipeline-shape-catalog.schema.json`**: `rowCount.kind` enum already includes `"unbounded"`
  (used by `passthrough`); the schema doesn't enumerate specific shape ids. Confirms no schema edit is
  actually needed, consistent with HEL-394 (`top-n`)'s precedent of not touching `schemas/` despite
  introducing its own new `RowCountContract` variant.

- **`backend/src/test/scala/com/helio/domain/shapes/PipelineShapeSpec.scala`**: confirmed current
  extend-don't-duplicate structure (independently-authored `expectedIds` set, per-shape lookup
  assertions, registry-equality assertion) that the plan correctly proposes to extend.

- **HEL-622 (Linear)**: confirmed filed, parented under `HEL-337`, content matches design.md Decision 5
  verbatim (gap-filling deferral, "needs its own design gate" framing, cross-references HEL-396/HEL-394's
  HEL-621 precedent). Not merely claimed in tasks.md — verified live.

- Scope check: no new pipeline op, no Flyway migration in the plan (all three ops — `datebucket`,
  `aggregate`, `sort` — pre-exist on main); panel/MCP/editor work explicitly and correctly excluded.

### Verdict: CONFIRM

### Non-blocking notes

- None required for this round; the three deliberately-flagged decisions (ordering, gap-filling, row-count
  contract) are all genuinely justified against ground truth rather than asserted, and the alias-collision
  guard is a real, correctly-scoped addition beyond the ticket's literal step list.
