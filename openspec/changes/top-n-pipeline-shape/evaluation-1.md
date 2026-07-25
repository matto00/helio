## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed: `top-n` shape registered with `measure`/`direction`/`n`/`ties` params
  in the catalog; `expand` yields `sort` + `limit`; ties policy documented (`strict` default) with
  any other value rejected via `Left` naming the `window`-op deferral (no silent reinterpretation);
  tests cover expansion (`TopNShapeSpec`) and end-to-end run (`TopNShapeEngineSpec`); no Flyway
  migration, additive-only (backward compatible).
- Tasks 1.1–1.7 and 2.1–2.7 all match the implemented code; only unchecked item is 3.1 (file a
  HEL-337 spinoff Linear ticket), which is explicitly an orchestrator/post-delivery action, not a
  code task — correctly left unchecked at this point in the workflow.
- No scope creep: the only changes outside the new `TopNShape.scala` are the two pre-authorized,
  design-gate-confirmed follow-ups (`SingleRowShape` `fn` case-insensitivity fix, named-shape HTTP
  catalog assertion), both explicitly called out in ticket.md's "Orchestrator pre-brief notes" and
  confirmed by the skeptic at the design gate.
- No regressions: full `sbt test` run (fresh, this cycle) — 1983 tests, all green, including
  pre-existing `SingleRowShape`/`PipelineShapeRoutesSpec`/`PipelineShapeSpec` suites.
- No API contract/schema change needed or made — `schemas/pipeline-shape-catalog.schema.json`
  already generically supports `AtMostParam`/empty `fields` (confirmed untouched in the diff, per
  skeptic's design-gate verification, re-confirmed here via `git diff --stat`).
- Planning artifacts (proposal/design/tasks/spec.md) accurately reflect the final implementation —
  no drift found between design.md's Decisions 1–5 and the shipped code.

### Phase 2: Code Review — PASS
Issues: none.

Verified via fresh diff read + full-file reads of `TopNShape.scala`, `PipelineShape.scala`,
`SingleRowShape.scala`, and all four modified/added test files:

- **Mechanical compliance**: `npm run check:scala-quality` run fresh — reports "Scala code-quality
  check: clean" (64 pre-existing soft file-size warnings, none touching files from this diff; no
  inline-FQN violations in `TopNShape.scala`/`PipelineShape.scala`/`SingleRowShape.scala`).
  `domain/shapes` main source still does not import `com.helio.api.protocols` (only doc-comment
  references in `ShapeStepExpansion.scala`/`PipelineShape.scala`, not actual imports) — layering
  convention preserved. No new Flyway migration (`git status backend/src/main/resources/db/migration/`
  clean).
- **DRY**: expansion reuses existing `SortConfig`/`SortKey`/`LimitConfig` case classes verbatim, no
  new step kinds or duplicated validation helpers; direction/ties conventions mirror
  `SingleRowShape`'s established patterns.
- **Readable / no magic values**: `SupportedDirections`, `DefaultTies` are named constants; each
  validation Left message is specific and named-field.
- **Type safety**: no `.asInstanceOf`/`Any`-typed escape hatches; `Either[String, _]` used
  consistently for validation, matching `SingleRowShape`'s convention.
- **Error handling**: `n <= 0` explicitly rejected before any step is built (mitigates
  `LimitStep`'s documented no-op-on-`count<=0` semantics, which would otherwise silently violate the
  `AtMostParam("n")` contract) — verified in code (`validateN`) and covered by a dedicated `TopNShapeSpec`
  case for `n=0` and `n=-1`.
- **Tests meaningful**: re-ran the tie-break test — `TopNShapeEngineSpec` uses a genuine 3-row
  fixture where the 2nd/3rd rows are tied at `score=5.0` while `n=2`, i.e. the tie sits exactly on
  the N/N+1 boundary; a distinguishing higher-scoring 1st row exists so the test isn't vacuous. The
  assertion (`Seq("first", "second")`) would fail if `SortStep`'s stability were ever broken. The
  `AtMostParam("n")` contract is directly exercised (`TopNShapeSpec` "outputContract" test) and its
  wire round-trip is confirmed pre-existing in `PipelineShapeProtocolSpec` (not duplicated, per
  files-modified.md — verified by grep, `{"kind":"at-most-param","paramName":"n"}` round-trip test
  present and unmodified). Registry-parity test now uses `Set("passthrough", "single-row", "top-n")`
  against `Registry.keySet`, with `Registry should have size 3` — genuinely would catch a
  registration/parity drift. The named-shape catalog HTTP assertion (`PipelineShapeRoutesSpec`)
  covers both `id = "single-row"` and `id = "top-n"` with non-empty `paramsSchema` for each.
- **`SingleRowShape` fix verified narrow and behavior-widening only**: `validateMeasures` now checks
  `SupportedFns.contains(m.fn.toLowerCase)` instead of `SupportedFns.contains(m.fn)` — a single line;
  `fn` on the wire/config remains unmodified (original casing preserved, confirmed via the new
  `SingleRowShapeSpec` case asserting `Aggregation("total", "SUM", "amount")` — original `"SUM"`
  casing, not lowered). No wire-casing change, matching the review brief's specific ask.
- **No dead code / no TODO|FIXME** in any new or modified file (grepped).
- **No over-engineering**: `expand` is a straightforward 4-step `for`-comprehension; no premature
  abstraction for the deferred `keep-ties`/per-group variants (correctly left as a documented `Left`
  + spinoff, not a half-built code path).
- **Behavior-preserving where expected**: the `SingleRowShape` fix and the new HTTP test are
  additive/widening only; no drive-by behavior changes found elsewhere in the diff.

Fresh gate re-runs (not trusting executor self-report):
- `npm run check:scala-quality` → clean.
- `sbt test` (full suite, from a clean `sbt -batch test` invocation) → **1983 tests, 109 suites, 0
  failures**, including all new `TopNShapeSpec`/`TopNShapeEngineSpec` cases and the extended
  `PipelineShapeSpec`/`SingleRowShapeSpec`/`PipelineShapeRoutesSpec` suites.
- `openspec validate top-n-pipeline-shape --strict` → "Change 'top-n-pipeline-shape' is valid".
- No backend Scala formatter is configured in this repo (only Prettier for frontend/config files,
  which this change does not touch) — nothing to run there.

### Phase 3: UI Review — N/A
This is a backend-only, domain/API-layer change. No files under `frontend/**`, no changes to
`backend/src/main/scala/com/helio/api/routes/ApiRoutes.scala`, no `schemas/**` changes, and while
`openspec/specs/**` (well, `openspec/changes/.../specs/**`) was touched, it documents an existing,
already-shipped-and-authenticated `GET /api/pipeline-shapes` catalog route with no new UI surface —
confirmed via `git diff --name-only` (backend/src and openspec/changes only). Dev servers were not
started; not required for this review.

### Overall: PASS

### Non-blocking Suggestions
- None beyond what the skeptic already flagged as optional polish at the design gate (the
  `WindowStep` vs. `SortStep` stability-comment tension) — not this ticket's responsibility to fix.
