# Files modified — HEL-1015

## Production code

- `backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala` — added `detectMapPaths`
  (D2/D2a compound classifier, outermost-wins, parent-present-rows denominator); made `leaves` and
  `flattenJsObject` take `mapPaths: Set[String]` as a REQUIRED parameter (no default, no
  same-named single-arg overload — D1); added `leavesUnclassified`/`flattenJsObjectUnclassified`
  as separately-named test-only escape hatches; `walk` now treats a path in `mapPaths` as a leaf
  (D4), never recursing into it.
- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` —
  `inferFromObjects` computes `JsonFlattener.detectMapPaths(objects)` once per batch and passes it
  to every per-object `leaves` call (consumer 1/3).
- `backend/src/main/scala/com/helio/domain/engine/PipelineRowJson.scala` — `jsRowToRow` gained a
  required `mapPaths: Set[String]` parameter; it does NOT compute classification itself (per-row
  classification is impossible in principle — design Context 1).
- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — both the
  `RestSource` and `SqlSource` branches of `loadRowsWithStats` now compute
  `JsonFlattener.detectMapPaths` once over the FULL `outcome.rows` batch, then map every row
  through `PipelineRowJson.jsRowToRow(_, mapPaths)` (consumer 2/3); added the `spray.json.JsObject`
  import needed for the `collect { case o: JsObject => o }` filter.
- `backend/src/main/scala/com/helio/services/sources/SourceService.scala` — `previewRest` now
  classifies `detectMapPaths` over the FULL `jsRows`, THEN `take(10)` for display (D6 — ordering,
  not logic), passing the same `mapPaths` into `flattenJsObject` (consumer 3/3).

## Test code — signature migration (mechanical, no assertions changed)

Per design D1/final-gate CR2, `leaves`/`flattenJsObject` becoming required-parameter broke every
existing single-object test call site. Each was migrated to the explicitly-named unclassified
variant (`leavesUnclassified`/`flattenJsObjectUnclassified`) or given `Set.empty` for `jsRowToRow`
— a pure signature change. **No test's assertion was altered to make it pass; every pre-existing
assertion is byte-identical to before this ticket.**

- `backend/src/test/scala/com/helio/domain/engine/JsonFlattenerSpec.scala` — all `leaves(obj)` →
  `leavesUnclassified(obj)`; `flattenJsObject(obj)` → `flattenJsObjectUnclassified(obj)`;
  `jsRowToRow(obj)` → `jsRowToRow(obj, Set.empty)`.
- `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala` —
  `leaves(json)` → `leavesUnclassified(json)`; `jsRowToRow(json)` → `jsRowToRow(json, Set.empty)`;
  `jsRowToRow(_)` → `jsRowToRow(_, Set.empty)` (the `assertAgreement` helper, called on inputs with
  no map-shaped field, so behaviour is unchanged).
- `backend/src/test/scala/com/helio/domain/engine/NestedJsonFlatteningSymmetrySpec.scala` — all 5
  `jsRowToRow(rowObj)` sites → `jsRowToRow(rowObj, Set.empty)` (single real-payload row, no
  cross-row signal exists to classify from — `Set.empty` matches D3's own single-row default).
- `backend/src/test/scala/com/helio/domain/engine/ExpressionEvaluatorSpec.scala` — both
  `flattenJsObject(...)` call sites → `flattenJsObjectUnclassified(...)`.

## Test code — new evidence

- `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala` — cycle 2, CR2:
  new regression test at the real `SourceService.preview`/`previewRest` seam (via the file's
  existing fake-connector pattern) using a synthetic 15-row fixture whose first 10 rows classify
  differently from the full batch, so mutating `previewRest` to `take(10)`-before-classify goes
  RED. Guards design.md D6's ordering trap, which previously had no guard at all.
- `backend/src/test/scala/com/helio/domain/engine/MapAwareJsonFlatteningSpec.scala` — new spec,
  17 tests, covering:
  - 1.1/1.2 (RED baseline reachability, via `leavesUnclassified` — pre-fix-equivalent, no revert
    needed to demonstrate the collapse is reachable)
  - 2.1/3.1 (post-fix `SchemaInferenceEngine` bounded-column behaviour on real payloads)
  - 4.1/4.2/4.3 (AC1/AC2/AC3, exact field-set assertions, real payloads)
  - 4.4/4.4a/4.4b/4.4c (D2 table pinned on real staged data, both conjuncts explicit; variant-
    payload counterexample; MAP-of-objects outermost-wins; struct-side residual mutation)
  - 4.5 (three-way schema/row/preview key-set agreement, the binding HEL-599 invariant)
- `backend/src/test/resources/hel1015/matchups.json`
- `backend/src/test/resources/hel1015/tx.json`
- `backend/src/test/resources/hel1015/projections-sample-200.json`
  the real staged Sleeper API payloads, committed verbatim as the fixtures' real-data source
  (task 5.3 decision: **committed**, not inlined — design.md D2's table cites these files by name
  and every number in it is reproducible from them; the repo-root `.hel1015-realdata/` staging
  copy was deleted after copying into this tracked test-resource location).

## Evidence — RED baseline (tasks 1.1/1.2, before touching the fix)

Both reachable via `JsonFlattener.leavesUnclassified` — a call that reproduces exactly what
production `leaves` did before this ticket (no path is ever classified MAP), so the union of its
output across a real payload's rows is the literal pre-fix column set. Both pass today as
regression proof of reachability (not reverted code — see rationale in the spec's own comment):

- `matchups.json` (12 real rows): 173 distinct `players_points.<id>` columns (design.md D2's
  measured union-key count). `playerPointsColumns.size shouldBe 173` — green.
- `tx.json` (36 real rows): a bare `drops` column (from 19 null rows) AND 16 distinct
  `drops.<id>` columns (from 17 object rows) coexist. `dropsPrefixColumns.size shouldBe 16` —
  green.

## Evidence — full-suite baseline vs. post-fix (task 1.3/5.1)

Ran `sbt test` from `backend/` TWICE: once with the fix `git stash`ed out (true pre-fix baseline,
including the new `MapAwareJsonFlatteningSpec` file also stashed since it's untracked+new), once
restored.

**Pre-fix baseline** (`git stash -u`, `sbt test`):
```
[info] Total number of tests run: 4031
[info] Tests: succeeded 4028, failed 3, canceled 0, ignored 0, pending 0
[error] Failed tests:
[error] 	com.helio.services.sources.ConnectorCompletionServiceSpec
[error] Total time: 314 s (0:05:14.0)
```
**Correction (cycle 2, per evaluation-1.md):** the count is **3**, all in ONE suite,
`ConnectorCompletionServiceSpec` — one token-expiry-timing test ("consume() itself refuses a
token that expired AFTER being read as live") plus two expiry-recovery re-mint tests. The
original wording above ("BOTH … failures") was a prose slip contradicted by the pasted transcript
immediately above it (which already said `failed 3`) — not a second measurement. These are
**pre-existing, time-sensitive, and unrelated to `JsonFlattener`** — confirmed independently by
the evaluator, who ran the unmodified spec three times on a throwaway `origin/main`-only worktree
(zero HEL-1015 code) and got `18 tests, 0 failed` all three times, and by the fact that the same
suite passed cleanly in the post-fix full run below with no code change in that area.

**Post-fix** (`git stash pop`, `sbt test`):
```
[info] Total number of tests run: 4048
[info] Suites: completed 272, aborted 0
[info] Tests: succeeded 4048, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
[success] Total time: 4 minutes, 47 seconds
```
4048 = 4031 baseline + 17 new `MapAwareJsonFlatteningSpec` tests. `ConnectorCompletionServiceSpec`
passed this run (timing-flaky, not a regression this fix introduced — no file in that area was
touched). Zero regressions across the rest of the 4031-test baseline.

## Evidence — mutation proof (task 4.6)

Flipped `JsonFlattener.MapCoverageThreshold` from `0.25` to `0.0` (makes the coverage conjunct
impossible to satisfy, so `detectMapPaths` never classifies anything as MAP — the classifier is
effectively disabled), ran `MapAwareJsonFlatteningSpec` alone, then restored and re-ran.

**Mutated (threshold = 0.0) — RED, as required:**
```
[info] Tests: succeeded 7, failed 10, canceled 0, ignored 0, pending 0
[info] *** 10 TESTS FAILED ***
```
10 of 17 tests failed, including exactly the ones the mutation should break: the post-fix
bounded-column assertions (2.1/3.1 both payloads), AC1/AC2 exact-field-set assertions, and every
`detectMapPaths` classification assertion (4.4/4.4a's own `mapPaths should not contain` checks
stayed green by construction since an always-STRUCT classifier trivially satisfies "not a map";
the ones asserting `mapPaths should contain(...)` went red as expected).

**Restored (threshold = 0.25) — green again:**
```
[info] Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

This is a GUARD, not a red-before-fix proof — labelled as such per the workflow-state.md evidence
rule ("A guard need not be red first but must be failable by mutation and labelled as such").

## Signature-migration statement (item 4 of the evidence-discipline block)

The required-parameter change to `leaves`/`flattenJsObject`/`jsRowToRow` is a **mechanical
signature migration**, not a weakened test. Every pre-existing test's ASSERTION (the `shouldBe`/
`should` line and its expected value) is byte-identical to its pre-ticket form; only the call
expression gained an explicit parameter or was renamed to the separately-named unclassified
variant, per the migration list above. Verified concretely: `git diff` on each of the four test
files shows only the call-site rename/parameter addition, never a changed expected value.

## HEL-1009 interaction

None. `SchemaInferenceEngine.inferShallowFromJsObjects` (HEL-891's shallow-union path,
`inferOutputSchema`'s caller per workflow-state.md) is untouched — it deliberately never called
`JsonFlattener.leaves` (see its own doc comment, unchanged) and so is outside this fix's blast
radius entirely. No file this ticket touches overlaps `PipelineAnalyzeService.scala:447`. Scope
stayed to the inference/materialisation/preview triad; HEL-1009 was not absorbed.

## Cycle 2 — addressing evaluation-1.md (both blocking Change Requests)

Rebased onto `origin/main` @ `db51e936` after cycle 1 yielded (commit `1c5edc44`); cycle 2 work is
on top of that rebase.

### Change Request 1 (BLOCKING) — the coverage conjunct had no struct-side guard

The struct-side test previously titled "non-empty intersection" measured only the intersection
conjunct — every struct fixture in the suite (`settings`/`metadata`/`stats`/`player`) has a
non-empty intersection, so raising the threshold arbitrarily (mutation `0.25 -> 0.99`) left all 17
tests green, exactly as the evaluator found.

**Fixed** in `backend/src/test/scala/com/helio/domain/engine/MapAwareJsonFlatteningSpec.scala`:

1. The struct-side D2-table test now pins BOTH conjuncts per field, with real numbers (tolerance
   `+- 0.001`) recomputed from the committed fixtures — `settings` 0.682/1, `metadata` 1.000/1,
   `stats` 0.580/16, `player` 1.000/14 — matching design.md D2 and the evaluator's independent
   recomputation exactly.
2. Added a new SYNTHETIC boundary fixture — `"boundary case: coverage ALONE decides STRUCT when
   intersection is empty"` — that isolates the coverage conjunct: 4 rows of size 3 from a 6-key
   union (`row0={a,b,c}`, `row1={b,c,d}`, `row2={c,d,e}`, `row3={d,e,f}`), measured coverage=0.5,
   intersection=0 (empty). No real staged payload has a multi-row map-shaped field with an empty
   intersection AND coverage safely above 0.25 — every real struct here has some shared key — so
   a hand-built case is the only way to isolate this conjunct; stated explicitly, per the
   constraint, as synthetic and why.

**Mutation A (`0.25 -> 0.0`)** — RED, reproduces cycle 1's result on the now-18-test suite:
```
[info] Tests: succeeded 8, failed 10, canceled 0, ignored 0, pending 0
[info] *** 10 TESTS FAILED ***
```

**Mutation B (`0.25 -> 0.99`, the evaluator's own mutation)** — now RED, where it was previously
green:
```
[info] - should boundary case: coverage ALONE decides STRUCT when intersection is empty (synthetic, isolates the coverage conjunct) *** FAILED ***
[info]   Set("m") contained element "m" (MapAwareJsonFlatteningSpec.scala:237)
[info] Tests: succeeded 17, failed 1, canceled 0, ignored 0, pending 0
[info] *** 1 TEST FAILED ***
```
Exactly the new coverage-only fixture catches it — the fixture whose STRUCT classification
depends entirely on the coverage conjunct flips to MAP once the threshold rises past 0.5, which
mutation B (`0.99`) triggers.

**Restored (`0.25`) — green again, both mutations:**
```
[info] Tests: succeeded 18, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

### Change Request 2 (BLOCKING) — D6's ordering trap had zero regression guard

Added a new test to `backend/src/test/scala/com/helio/services/sources/SourceServiceSpec.scala`,
exercising the REAL `SourceService.preview`/`previewRest` seam (not a re-implementation of its
logic) via the existing `restConnector`/`service` test doubles already used by every other test
in that file. Fixture is SYNTHETIC (no real staged payload happens to have a field whose first 10
rows classify differently from its full set): 15 rows total, field `"m"` — rows 0-9 each carry
`{"shared": i}` (union={shared}, coverage=1.0, intersection={shared} → STRUCT over just those 10),
rows 10-14 each carry a distinct never-repeated key (over the full 15: union=6 keys,
coverage=mean(1/6)=0.167<0.25, intersection=empty → MAP). Asserts the schema's field-name set AND
every displayed preview row's key set both equal `Set("m")`.

**Mutated** (`previewRest`'s `mapPaths` computed over `jsRows.take(10)` instead of the full
`jsRows` — the exact wrong ordering D6 calls "the trap") — RED:
```
[info] - should classifies over the FULL fetched batch, not the displayed take(10) (D6 ordering, real seam) *** FAILED ***
[info]   Set(Set("m.shared")) was not equal to Set(Set("m")) (SourceServiceSpec.scala:595)
[info] Tests: succeeded 26, failed 1, canceled 0, ignored 0, pending 0
```

**Restored** (`previewRest` back to classifying over the full `jsRows`, then `take(10)`) — green:
```
[info] Tests: succeeded 27, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

### Non-blocking suggestions addressed

- `SchemaInferenceEngineSpec.scala`'s `assertAgreement` helper now computes
  `JsonFlattener.detectMapPaths(rows.toVector)` and passes that (not `Set.empty`) into
  `PipelineRowJson.jsRowToRow`, so it keeps testing the schema/row agreement invariant its own
  name claims, for a map-shaped input too — not only the structs it happened to be called on.
- `JsonFlattener.scala`'s inline `scala.collection.mutable.Set.empty[String]` replaced with a
  top-of-file `import scala.collection.mutable` and `mutable.Set.empty[String]` at the use site.
- Added a one-line comment on test 4.5 clarifying it guards cross-consumer DIVERGENCE (given the
  same `mapPaths`, do the three flatteners agree?), not classifier-threshold coverage — that lives
  in 4.4's boundary fixtures — and not D6's ordering seam, which lives in the new
  `SourceServiceSpec` test.

### Cycle 2 signature-migration statement

No test assertion was weakened or reshaped. `assertAgreement`'s change (`Set.empty` →
`detectMapPaths(rows.toVector)`) STRENGTHENS the helper — it can now detect a real divergence on a
map-shaped input it previously could not — and every existing call site of `assertAgreement`
passes unchanged (none of them are map-shaped, so the computed `mapPaths` is empty there too,
identical to before).

## Gates (cycle 2, on the rebased base)

- `sbt test` (backend), full suite, fresh: **4050/4050 passed, 0 failed** (4048 + 2 new tests: the
  coverage-only boundary fixture, the D6 ordering regression test).
  ```
  [info] Total number of tests run: 4050
  [info] Tests: succeeded 4050, failed 0, canceled 0, ignored 0, pending 0
  [info] All tests passed.
  ```
- `node scripts/check-scala-quality.mjs`: exit 0. No inline-FQN violations; only pre-existing
  file-size soft-budget warnings (now including the two grown spec files, still soft/non-blocking).
- Frontend gates (lint/format/test/build) not run — no `frontend/**` file touched.
