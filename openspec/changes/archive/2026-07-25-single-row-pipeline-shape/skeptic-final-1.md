## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` at HEAD `04d673b3` — 15 files, scoped to
  `backend/src/main/scala/com/helio/domain/shapes/{OutputContract,PipelineShape,SingleRowShape}.scala`,
  two new test files, `PipelineShapeSpec.scala` extension, and the OpenSpec change dir. No frontend,
  no route file, no schema file touched. No scope creep.

- **AC1 (catalog entry)** — verified LIVE, not just via unit tests: started real servers
  (`scripts/concertino/start-servers.sh ... 5566 8473`), logged in as the dev account, and called
  `GET http://localhost:8473/api/pipeline-shapes` with a real session cookie. Response includes both
  `passthrough` and a `single-row` entry with `outputContract.rowCount.kind = "exactly-one"`,
  `outputContract.fields = []`, and the four `paramsSchema` descriptors (`mode`/`measures`/`conditions`/
  `combinator`) exactly as `SingleRowShape.scala` declares them. Confirmed this is wired through
  `PipelineShapeService.catalog()` iterating `PipelineShape.Registry.values` (read the file directly) —
  not merely present in isolation.

- **AC2 (expand → valid step list → executes to one row)** — read `SingleRowShape.scala` in full.
  Aggregate mode: `AggregateConfig(groupBy = Vector.empty, aggregations = measures)` → collapses all
  rows to one group (confirmed against `AggregateStep.apply`'s `rows.groupBy(...)` on an empty
  `groupByFields` list). Filter mode returns `Vector(FilterStep-expansion, LimitStep-expansion)` in that
  order — `limit 1` genuinely follows `filter` in the step list. Re-ran the actual test suite fresh
  (not trusted from prior reports): `sbt testOnly com.helio.domain.shapes.SingleRowShapeSpec
  com.helio.domain.shapes.PipelineShapeSpec com.helio.domain.SingleRowShapeEngineSpec` → 26/26 passed.
  `SingleRowShapeEngineSpec` runs both expansions through the real `InProcessPipelineEngine` against a
  3-row source: aggregate mode yields one row with correct `sum`/`count` values; filter mode (2 of 3
  rows match) yields exactly one row (`alice`), proving `limit 1` is applied after `filter`, not before.

- **AC3 (backward compatible / additive)** — `ls backend/src/main/resources/db/migration/` still tops
  out at `V72__add_lookup_op.sql`; no new migration in the diff. `OutputContract.scala`'s change is
  doc-comment-only (verified line-by-line — the `sealed trait RowCountContract` declaration is
  unchanged, only the stale "non-sealed" prose is corrected). `PipelineShape.scala`'s change is one
  added `Registry` line. No existing step/pipeline/shape behavior altered — confirmed via the full
  `sbt test` run below (zero regressions).

- **Full backend suite, re-run fresh**: `cd backend && sbt test` → **1963 tests, 1963 succeeded, 0
  failed, 0 canceled** — matches the evaluator's claimed count, independently reproduced.

- **Gates re-run fresh**: `npm run check:scala-quality` → clean (only pre-existing soft file-size
  warnings unrelated to this change). `npm run check:schemas` → in sync. `npm run lint` → 0 warnings.
  `npm run format:check` → clean. `schemas/pipeline-shape-catalog.schema.json` read directly — already
  supports `rowCount.kind = "exactly-one"` and an empty `fields` array; no schema change was needed and
  none was made, matching the live response shape exactly.

- **No inline FQNs** (project pet peeve, `CONTRIBUTING.md` "Imports & Qualifiers"): grepped
  `SingleRowShape.scala` for `com\.helio\.|akka\.|org\.apache\.` — only top-of-file imports and
  scaladoc `[[...]]` cross-reference links, no inline qualifiers in executable code.

- **Layering ban**: grepped `domain/shapes/` for `com.helio.api.protocols` — zero matches (only a
  scaladoc comment in `ShapeStepExpansion.scala` mentions the FQN in prose, not code). `Aggregation`/
  `FilterCondition` are correctly sourced from `com.helio.domain.steps`, matching `PassthroughShape`'s
  precedent.

- **Design-gate skeptic's non-blocking note #3** (Try-wrap `convertTo` calls on array items so a
  malformed-type measure/condition returns `Left` instead of throwing) — confirmed implemented:
  `items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)` / same pattern for `FilterCondition`,
  with a length-mismatch check (`measures.length != items.length`) triggering `Left`. Explicitly tested
  (`"return Left when a measure's \"fn\" is not a string (malformed item, decoded via Try not
  thrown)"`) — ran this test directly, passes.

- **Design.md decisions vs. implementation**: read all six Decisions and cross-checked against
  `SingleRowShape.scala` — mode-discriminated union under one registry id (Decision 1), reuse of
  `Aggregation`/`FilterCondition` (Decision 2), `fn`/`operator`/`combinator`/duplicate-alias validation
  in `expand` rather than deferring to step runtime behavior (Decision 3), `fields = Vector.empty`
  (Decision 4), independently-authored registry-parity literal set (Decision 5, verified in
  `PipelineShapeSpec.scala`), doc-comment-only `OutputContract.scala` fix (Decision 6) — no drift found.

- **Edge cases probed**: empty params object `{}` → `Left` (missing mode); both modes' malformed-type
  items → `Left` via `Try`; duplicate aliases → `Left`, tested and re-run; unsupported `fn`/`operator`/
  `combinator` → `Left`, tested and re-run; `limit(1)` ordering after `filter` → proven via the engine
  spec's 3-row/2-match scenario, re-run and passing.

### Minor observations (non-blocking, already flagged by evaluator/design-skeptic — independently confirmed, not newly discovered)

- `fn`/`operator` validation in `expand` is case-sensitive against lowercase-only sets, while
  `combinator` is explicitly case-insensitive in the same file — an inconsistency, not a spec violation
  (no AC/spec.md scenario requires case-insensitive `fn`/`operator`).
- No HTTP-layer test in `PipelineShapeRoutesSpec`/`ApiRoutesSpec` asserts `single-row` by name in the
  `GET /api/pipeline-shapes` response body — I closed this gap myself by hitting the live endpoint
  directly (see AC1 above), which confirms the behavior is correct; the missing regression-test
  coverage is a defensible non-blocking suggestion for a follow-up, not a functional defect.

### Verdict: CONFIRM

### Non-blocking notes
- Consider adding an HTTP-layer assertion (`PipelineShapeRoutesSpec` or `ApiRoutesSpec`) naming
  `single-row` explicitly in the catalog response, mirroring the existing `passthrough` coverage —
  currently the behavior is correct by construction and verified live by this review, but there's no
  regression test at the HTTP layer specifically for the new shape.
- Consider case-insensitive `fn`/`operator` matching in a follow-up for consistency with `combinator`'s
  handling in the same file (not required by any AC or spec.md scenario).
