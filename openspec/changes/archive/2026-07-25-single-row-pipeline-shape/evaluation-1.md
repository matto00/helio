## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 ("single-row shape appears in `GET /api/pipeline-shapes` with params schema + output contract")
  is satisfied by construction: `PipelineShapeService.catalog()` iterates `PipelineShape.Registry.values`
  and `PipelineShape.Registry` now includes `SingleRowShape.id -> SingleRowShape` (verified via
  `PipelineShapeSpec`'s registry-equality + registry-parity assertions, and via reading
  `PipelineShapeService.scala`/`PipelineShapeRoutes.scala`/`PipelineShapeProtocol.scala` directly — the
  wire format already supports `ExactlyOne` from HEL-391, no code change needed there). Ticket's AC
  text says `GET /api/pipelines/shapes`; the pre-briefing note correctly identifies this as stale —
  actual endpoint `GET /api/pipeline-shapes` is correct, per HEL-391.
- AC2 (`expand(params)` yields a valid step list for both modes, one row on execution) — verified via
  `SingleRowShapeSpec` (unit) and `SingleRowShapeEngineSpec` (end-to-end through
  `InProcessPipelineEngine`), both passing.
- AC3 (tests: expansion → step list, e2e run → one row) — present and passing (31/31 new/updated tests
  green; see Phase 2 for full-suite run).
- AC4 (additive, no persisted schema change, reuses existing ops only) — confirmed: no Flyway migration
  added (latest is still `V72__add_lookup_op.sql`), no `schemas/`/`openspec/specs/` (canonical) diff, no
  new pipeline op — `expand` only emits `aggregate`/`filter`/`limit` step kinds that already exist.
- `outputContract.fields = Vector.empty` (not populated with the declared measure/filter columns) is a
  literal reading gap against the ticket's Scope-section prose ("Output contract: exactly one row with
  the declared measure columns"), but this is not a silent reinterpretation — design.md Decision 4 and
  the proposal's Non-goals section call it out explicitly, justify it against the binding HEL-391
  `outputContract: OutputContract` (a `def`, declared once per shape, not computed per `expand` call),
  and this was independently verified by the skeptic at the design gate (skeptic-design-1.md, point 5,
  CONFIRM verdict). Documented, reasoned trade-off, not scope drift.
- Tasks.md: all 12 items checked and each maps to a real, verifiable code/test change (cross-checked
  against the diff — no task claimed done that isn't reflected in code).
- No scope creep: diff touches only `backend/src/main/scala/com/helio/domain/shapes/*`,
  `backend/src/test/scala/com/helio/domain/**`, and the OpenSpec change dir. No frontend, no route, no
  schema, no migration files.
- No regressions to existing behavior: full `sbt test` run (see Phase 2) — 1963/1963 pass, including all
  pre-existing `PassthroughShapeSpec`/`PipelineShapeRoutesSpec`/`ApiRoutesSpec` shape-catalog coverage.
- Planning artifacts (proposal/design/tasks/spec delta) accurately reflect the final implementation —
  cross-checked design.md's 6 Decisions and Risks against the actual `SingleRowShape.scala` code; all
  match (mode-discriminated union, `Aggregation`/`FilterCondition` reuse, `fn`/`operator`/`combinator`/
  duplicate-alias validation, `fields = Vector.empty`, doc-comment-only `OutputContract.scala` fix).

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Imports/qualifiers (CONTRIBUTING.md, mechanical)**: `npm run check:scala-quality` (the CI-enforced,
  mechanical version of this rule) run fresh — clean, 0 violations in the new/changed files (64
  pre-existing soft file-size warnings elsewhere in the repo, none touching this change's files).
  `SingleRowShape.scala` uses top-of-file imports throughout, no inline FQNs.
- **File-size budget**: `SingleRowShape.scala` is 198 lines — under the 250-line soft budget.
- **Layering ban** (`domain/shapes` must not import `com.helio.api.protocols`, HEL-391 design.md
  Decision 1): grepped `SingleRowShape.scala` and the whole `domain/shapes/` dir — no
  `com.helio.api.protocols` import anywhere. `Aggregation`/`FilterCondition` are correctly sourced from
  `com.helio.domain.steps` (domain layer), matching `PassthroughShape`'s precedent.
- **DRY**: reuses `Aggregation`/`FilterCondition`/`AggregateConfig`/`FilterConfig`/`LimitConfig` and
  their existing `RootJsonFormat`s rather than inventing parallel shape-local case classes — matches
  design.md Decision 2's stated rationale exactly.
- **Type safety**: no `asInstanceOf`/`Any` escape hatches in the new code beyond what the existing step
  layer already uses (`AggregateConfig`/`FilterConfig` decode paths, unchanged).
- **Error handling**: `expand` never throws — the skeptic's design-gate note 3 (malformed-type items,
  e.g. `fn` as a `JsNumber`, must be `Try`-wrapped per item rather than calling `.convertTo[...]` bare)
  was correctly implemented (`items.flatMap(it => Try(it.convertTo[Aggregation]).toOption)` /
  same pattern for `FilterCondition`) and is explicitly tested (`SingleRowShapeSpec`: "return Left when a
  measure's \"fn\" is not a string (malformed item, decoded via Try not thrown)" — asserts
  `noException should be thrownBy`).
- **Tests meaningful**: `SingleRowShapeSpec` (23 cases: both modes' success/failure paths, AC3
  decode-cross-check), `SingleRowShapeEngineSpec` (2 cases: real engine execution proving `limit 1`
  follows `filter`, and aggregate values are correct), `PipelineShapeSpec` (registry-parity + lookup).
  All 31 targeted tests pass; ran fresh (`sbt testOnly`), not trusted from the executor's report.
- **No dead code**: no TODO/FIXME, no unused imports in the new files.
- **No over-engineering**: single `mode`-discriminated shape id per design.md Decision 1 (rejected
  splitting into two registry entries) — matches the ticket's literal "one shape, two modes" framing.
- **Behavior-preserving refactor**: `OutputContract.scala`'s change is doc-comment-only (confirmed via
  diff — no code line changed), correctly fixing a stale claim ("non-`sealed`") against the actual
  `sealed trait RowCountContract` declaration.
- **Gates re-run fresh** (not trusting executor's report):
  - `npm run check:scala-quality` — clean.
  - `npm run check:schemas` — in sync (19 protocols, 7 panel-type surfaces).
  - `npm run check:openspec` — only flags "change complete but not archived," expected pre-archive at
    this workflow stage, not a code issue.
  - `cd backend && sbt test` — full suite: **1963 tests, 1963 succeeded, 0 failed**, including all new
    HEL-393 tests and no regressions in pre-existing `PassthroughShapeSpec`/`PipelineShapeRoutesSpec`/
    `ApiRoutesSpec` shape-catalog coverage.
  - No Flyway migration added — confirmed `ls backend/src/main/resources/db/migration/` still tops out
    at `V72__add_lookup_op.sql`.
  - No `scalafmt` plugin is configured for this backend (`project/plugins.sbt` has no scalafmt entry) —
    not a gate that applies here.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**`
(canonical spec dir) changes in this diff — confirmed via `git diff main...HEAD --stat` and a targeted
`git diff main...HEAD -- 'openspec/specs/**'` (empty). The `specs/pipeline-shape-registry/spec.md` diff
present in this change is the OpenSpec *change-proposal* delta
(`openspec/changes/single-row-pipeline-shape/specs/...`), not the canonical `openspec/specs/` tree, so
it does not trigger Phase 3 per the trigger list. Dev servers were not started (not required).

### Overall: PASS

### Non-blocking Suggestions
- `OutputContract.scala` line 12's doc comment ("`ExactlyOne`: the shape always produces exactly one row
  (e.g. a future single-row shape)") is now stale — `single-row` is a real, registered shape as of this
  change, not a hypothetical future one. Trivial wording fix, not functionally significant.
- `SingleRowShape.validateMeasures`/`validateConditions` compare `fn`/`operator` case-sensitively against
  `SupportedFns`/`SupportedOperators` (both lowercase-only sets), while `AggregateStep.apply` itself
  lowercases `fn` before matching at runtime and `combinator` is explicitly made case-insensitive in this
  same shape. A caller passing `fn: "SUM"` would be rejected by `expand` even though the underlying step
  would execute it correctly. Not a spec violation (no AC/spec.md scenario requires case-insensitive
  `fn`/`operator`), but worth a follow-up for consistency with the `combinator` handling in the same file.
- No test in `PipelineShapeRoutesSpec`/`ApiRoutesSpec` asserts that `single-row` (specifically, with its
  `paramsSchema`/`outputContract`) appears in the actual `GET /api/pipeline-shapes` HTTP response —
  coverage stops at the domain-level `PipelineShape.Registry` check. The behavior is guaranteed correct
  by construction (catalog is generically derived from the Registry, verified by reading
  `PipelineShapeService.catalog()`), so this is not a functional gap, but an HTTP-layer regression test
  naming `single-row` explicitly (mirroring the existing `passthrough` assertions in both spec files)
  would strengthen AC1's regression coverage.
