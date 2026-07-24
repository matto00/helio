## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ground truth diff**: `git diff main...HEAD --stat` — 19 files, backend-only substantive change
  (domain: `Connector.scala`, `RestApiConnector.scala`, `SqlConnector.scala`,
  `SchemaInferenceEngine.scala`; services: new `SchemaInferenceFacade.scala`, `SourceService.scala`;
  4 new/extended test files). No `frontend/**`, `ApiRoutes.scala`, or `openspec/specs/**`
  touched — confirmed Phase 3/UI review is genuinely N/A.

- **AC 1 (inferred schemas unchanged)**: read `SchemaInferenceEngine.scala` fully — traced
  `mergeObjects`/`flattenObject` by hand for the two edge cases `inferSchemaFromRows` newly routes
  through that `fromJson` didn't before: (a) a single-JsObject "row" — `mergeObjects(Seq(obj))`
  is a no-op reconstruction of `obj`'s fields as a Map, `flattenObject` sorts by key so Map-vs-object
  field order doesn't matter — byte-identical to the old `case obj: JsObject` branch; (b) a
  non-object scalar wrapped via `RestApiConnector.toRows`'s `case other => Vector(other)` —
  `JsArray(Vector(other)).elements.collect{case o:JsObject=>o}` yields `Seq.empty`,
  `mergeObjects(Seq.empty)` → `JsObject.empty`, `flattenObject` → `Seq.empty` — matches the old
  `case _ => InferredSchema(Seq.empty)` exactly. Both hand-traced equivalences match design.md
  Decision 1's proof and are additionally exercised by fresh, passing tests (see below).

- **AC 2 (single InferredField→DataField projection)**: read `SchemaInferenceFacade.scala` in full
  and the `SourceService.scala` diff — confirmed all four inline copies (`createSql`, `createRest`
  with overrides, `refreshSql`, `refreshRest`) are replaced by
  `SchemaInferenceFacade.toDataFields(schema[, overridesMap])`. Signature matches design.md
  Decision 2 exactly.

- **AC 3 (test connector proving the facade)**: read `NewConnectorInferenceSpec.scala` in full —
  a genuine new `Connector[RowSupplyingConfig]` fixture (`RowSupplyingConnector`) whose
  `inferSchema` does nothing but `fetch` + `inferSchemaFromRows`, asserting correct field
  names/types/nullability, including a "no fabricated extras" test. Matches spec.md's "A test
  connector supplying arbitrary rows infers correctly" scenario.

- **AC 4 (backward-compatible)**: fresh `sbt test` run (not reused from evaluator) —
  **1740/1740 passing, 97 suites, 0 failures** in 71s. Targeted fresh re-run of
  `SchemaInferenceRegressionSpec`, `SourceServiceSpec`, `SchemaInferenceFacadeSpec`,
  `SchemaInferenceEngineSpec`, `NewConnectorInferenceSpec` — **58/58 passing**.

- **Item 1 (six routed SourceService methods, maxRows/error parity)**: read `SqlConnector.scala`
  in full — `SqlConnector.inferSchema(config)(implicit ec)` calls `execute(config, maxRows = 100)`,
  identical to the `maxRows` every prior direct `SourceService` call site used. Read
  `RestApiConnector.scala` in full — `inferSchema(config)` calls the same `fetch(config)` the old
  `inferRest`/`refreshRest`/`createRest` called directly. In all six `SourceService` methods
  (read the full diff), the `Left(err)` branch flows from the connector's own `Either` via
  `.map(_.map(...))`, untouched by this diff — error strings pass through byte-for-byte.

- **Item 2 (previewSql/previewRest untouched)**: read `SourceService.scala` lines ~230-256 directly
  (not just the diff) — both still call `SqlConnector.execute`/`connector.fetch` directly, absent
  from any diff hunk. Confirmed.

- **Item 3 (trait doc comment names inferSchemaFromRows)**: read `Connector.scala`'s full doc
  comment — the `'''Schema inference''' (HEL-473)` block literally names
  `SchemaInferenceEngine.inferSchemaFromRows`, matching spec.md's "Trait doc comment names the
  inference contract" scenario verbatim, not a paraphrase.

- **Item 4 (no existing test suite modified to accommodate new code)**:
  `git diff main...HEAD --diff-filter=M -- backend/src/test` — only
  `SchemaInferenceEngineSpec.scala` modified, purely additive (new `inferSchemaFromRows` block
  appended, no existing assertions touched, confirmed by reading the diff). `find` confirms
  `SchemaInferenceRegressionSpec.scala` exists and has zero diff hunks.

- **Item 5 (HEL-615 bumpVersion inertness — pre-existing, not exacerbated)**: read
  `DataTypeRepository.update` directly — confirmed it unconditionally computes
  `newVersion = existing.version + 1` and never reads `dt.version`, independent of this diff (the
  file is not touched by `git diff main...HEAD`). Read `SourceService.scala`'s `upsertDataType` and
  the `bumpVersion = true/false` call sites at `refreshSql`/`refreshRest` — confirmed those lines
  are **not present in the diff** (unchanged pre-existing code, only the caller context around them
  changed). `SourceServiceSpec.scala` lines 278-299 (read directly) document the actual observed
  behavior with an explanatory comment rather than asserting the nominal `bumpVersion=false` intent
  — transparent, not a new silent dependency. No new code path in this changeset assumes
  `bumpVersion` controls anything.

- **Item 6 (SPI/design-precedent consistency)**: read
  `openspec/changes/archive/2026-07-24-connector-spi-shared-trait/design.md`'s "Sibling ownership
  map" and ExecutionContext decision directly — confirms HEL-449 explicitly deferred "Schema-
  inference facade / polymorphic dispatch through the trait" to HEL-473, and stated "HEL-473 ...
  will call the trait polymorphically across connector types and MUST keep threading its own
  `(implicit ec)` through." Verified in the actual shipped code: `SourceService`'s class-level
  `(implicit ec: ExecutionContext)` (line 40) is the same implicit threaded (unchanged) into all six
  `connector.inferSchema(config)` / `SqlConnector.inferSchema(config)` calls — no new call site
  defaults or sources its own EC. `RestApiConnector.inferSchema`'s caller-supplied `ec` is only ever
  used to `.map` an already-completed `Future`'s result (never used to run `doFetch`'s blocking I/O,
  which still runs on the class's own `system.executionContext` at line 30) — the pre-existing
  asymmetry HEL-449's skeptic gate flagged is unchanged, not exacerbated, matching design.md
  Decision 4's claim exactly.

- **Quality gates, fresh**: `npm run check:scala-quality` → clean (0 inline-FQN violations;
  spot-checked with `grep` across all 5 touched/new main files — only package declarations and
  doc-comment prose reference `com.helio.*`/`scala.concurrent.*`, no inline FQNs in code). Only
  pre-existing file-size soft-budget warnings on files untouched by this ticket's logic.
  `npm run check:openspec` fails with "complete (17/17) but not archived" — matches the reason
  disclosed in commit `743f7f92`'s body for the `-n` bypass; expected at this delivery stage
  (archiving is a later step), not a blocker.

- **Commit hygiene**: `git show -s 743f7f92` — body explicitly discloses the `-n` hook bypass and
  the correct reason, consistent with CONTRIBUTING.md's bypass-disclosure rule.

### Verdict: CONFIRM

All four ticket ACs trace to real, independently-verified code and passing tests. The two
mathematically nontrivial equivalence claims in design.md (single-object and non-object-scalar REST
response routing) were hand-traced through `mergeObjects`/`flattenObject` against actual source, not
taken on faith. The EC-asymmetry precedent from HEL-449's design.md was read directly and confirmed
unchanged. The pre-existing `bumpVersion` inertness (HEL-615) is unmodified and transparently
documented, not silently relied upon by any new code. `previewSql`/`previewRest` and
`SchemaInferenceRegressionSpec` are genuinely untouched. Fresh `sbt test` (1740/1740) and targeted
suite reruns (58/58) both pass; quality gates are clean.

### Non-blocking notes

- None beyond what design-gate round 2 and evaluation-1.md already flagged (the
  `SourceConfigParsing` precedent citation in design.md Decision 2 is a slightly loose analogy —
  doesn't affect the layering conclusion; the `DataSourceService` CSV-path duplication is correctly
  deferred as a documented non-goal/spinoff candidate).
