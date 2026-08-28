# Red-verification transcript — HEL-858 task 3.11

Produced by an ACTUAL revert: `git checkout 7972247c -- backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala`
(equivalent to `git stash` for these two files, since both were already committed to this branch
by the time of this re-capture — `7972247c` is this branch's base commit and the pre-fix version
of both files), running the suite, then `git checkout HEAD -- <same two files>` to restore. Not
asserted from expectation.

**Regenerated in cycle 3** after `SchemaInferenceEngineSpec.scala`'s task-3.10 test was
strengthened in cycle 2 to pin `nullable`/`FloatType` post-fix answers directly (evaluation-1.md
CR2) without re-running this revert afterward — evaluation-2.md Finding A caught that the
previous version of this file (73/7, "no `[CHAR]` test went red on revert") no longer described
the suite that exists. This capture supersedes it.

Command run against the reverted (pre-fix) source, with all new/modified test files still in
place:

```
cd backend && sbt -batch "testOnly *SchemaInferenceEngineSpec *JsonFlattenerSpec *NestedJsonFlatteningSymmetrySpec *SparkJobSubmitterSpec"
```

Result: **73 succeeded, 8 failed**, out of 81 total. Exactly the 7 tests classified `[RED]` in
tasks.md failed, **plus task 3.10b** (`"pin the WR-only fixture's full field-by-field schema
(name, type, nullable)"`), which cycle 2's strengthening moved from characterisation to
red-on-revert by construction: it pins 4 post-fix values (two `nullable` flips, two `integer →
float` widenings) among the 63 fields it asserts. `tasks.md` now classifies 3.10 as split —
**3.10a `[CHAR]`** (field-name set only, 63 names) and **3.10b `[RED]`** (the full pinned
triple) — matching this transcript. Every other `[CHAR]` test stayed green.

## [RED] tests — all failed on revert, as required

| Task | Test | Result on revert |
|---|---|---|
| 3.1 | `SchemaInferenceEngineSpec` — "infer an identical schema regardless of row order (reversed and shuffled)" | **FAILED** — the pinned content map `Map("id" -> IntegerType, "stats.a" -> IntegerType)` (pre-fix, first-value-wins) did not match the expected `Map("id" -> IntegerType, "stats.a" -> FloatType, "stats.b" -> FloatType, "stats.c" -> StringType)` |
| 3.2 | `SchemaInferenceEngineSpec` — "include a nested path even when the first element lacks it" | **FAILED** — `List("stats.a")` did not contain `"stats.rec"` |
| 3.3 | `SchemaInferenceEngineSpec` — "widen types across sampled values per the JSON lattice" | **FAILED** — `IntegerType` was not equal to `FloatType` (widening not applied) |
| 3.6 | `SchemaInferenceEngineSpec` — "emit both a scalar path and its subtree path on a cross-row leaf-vs-subtree collision" (design D5) | **FAILED** — `List("a")` did not contain all of `("a", "a.b")` |
| 3.8b | `SchemaInferenceEngineSpec` — "hold the three-sided agreement property on heterogeneous shapes and cross-row collisions (fix-dependent)" | **FAILED** — `List("stats.a")` did not contain `"stats.rec"` |
| 3.9 | `SchemaInferenceEngineSpec` — "infer the full stats.rec* family from the live mixed-position Sleeper fixture" (AC4) | **FAILED** — inferred field list omits `stats.rec`, `stats.rec_yd`, `stats.rec_td` entirely (top-level `stats` from the first QB row won wholesale) |
| 3.4 | `SparkJobSubmitterSpec` — "does not truncate a fractional value when the declared column type is derived from SchemaInferenceEngine.fromJson" | **FAILED** — declared column type was `"integer"` (expected `"float"`); pre-fix inference declares the column from the first sampled value (`3`) and truncates `2.5` downstream |
| 3.10b | `SchemaInferenceEngineSpec` — "pin the WR-only fixture's full field-by-field schema (name, type, nullable)" | **FAILED** — pre-fix, `player.injury_body_part`/`player.injury_status` pinned `false` (post-fix values are `true`) and `stats.pts_half_ppr`/`stats.rec_fd` pinned `IntegerType` (post-fix values are `FloatType`); every other one of the 63 pinned triples matched |

## [CHAR] tests — all stayed green on revert, as required

- `SchemaInferenceEngineSpec` — "infer a nullable StringType for a path that is null in every sampled object" (3.3b) — GREEN
- `SchemaInferenceEngineSpec` — "not mark field nullable when merely absent from some sampled objects" (3.5) — GREEN
- `SchemaInferenceEngineSpec` — "still collapse a within-object literal-dotted-key vs nested-path collision to one field" (3.7) — GREEN
- `SchemaInferenceEngineSpec` — "hold the three-sided agreement property on inputs where it already held pre-fix" (3.8a) — GREEN
- `SchemaInferenceEngineSpec` — "characterise the existing WR-only fixture's field-NAME set (unaffected by this ticket)" (3.10a) — GREEN
- All pre-existing `SchemaInferenceEngineSpec` tests (root-object inference, CSV, displayName, `DataFieldType.asString`, the HEL-599 collision/symmetry tests) — GREEN
- `JsonFlattenerSpec` (entirely untouched by this ticket per design D1/1.6) — all GREEN
- `NestedJsonFlatteningSymmetrySpec` (entirely untouched by source changes; comment-only fix in cycle 3) — all GREEN
- `SparkJobSubmitterSpec`'s pre-existing tests (`applyStep`, `collectRows`, `submit`, the original `loadDataFrame` tests) — all GREEN

**One `[CHAR]`-labelled-as-of-cycle-1 test did go red on revert this cycle, and it IS reported
here, not absorbed.** That was task 3.10 before cycle-3's split: cycle 2 strengthened it to pin
post-fix answers, which made it red on revert without the classification or this transcript being
updated to match (evaluation-2.md Finding A). Cycle 3 resolved this by splitting 3.10 into
**3.10a `[CHAR]`** (genuinely green both ways — field names only) and **3.10b `[RED]`** (the
full pinned triple, genuinely red on revert — see the table above), and by re-running this exact
revert to produce this transcript. As of this capture, every test currently classified `[CHAR]`
in `tasks.md` is confirmed green on revert, and every test currently classified `[RED]` is
confirmed red on revert — no mismatch remains.

## sbt output (revert run, abridged: roll-ups like "(all N GREEN)" and one ellipsis in the
3.10b failure message replace long uninteresting spans; every FAILED/succeeded line and count is
verbatim)

```
[info] SchemaInferenceEngineSpec:
[info] SchemaInferenceEngine.fromJson  (all 14 GREEN)
[info] SchemaInferenceEngine.fromJson (HEL-858 recursive merge / widening)
[info] - should infer an identical schema regardless of row order (reversed and shuffled) *** FAILED ***
[info]   Map("id" -> IntegerType, "stats.a" -> IntegerType) was not equal to Map("id" -> IntegerType, "stats.a" -> FloatType, "stats.b" -> FloatType, "stats.c" -> StringType) (SchemaInferenceEngineSpec.scala:134)
[info] - should include a nested path even when the first element lacks it *** FAILED ***
[info]   List("stats.a") did not contain element "stats.rec" (SchemaInferenceEngineSpec.scala:156)
[info] - should widen types across sampled values per the JSON lattice *** FAILED ***
[info]   IntegerType was not equal to FloatType (SchemaInferenceEngineSpec.scala:168)
[info] - should infer a nullable StringType for a path that is null in every sampled object
[info] - should emit both a scalar path and its subtree path on a cross-row leaf-vs-subtree collision *** FAILED ***
[info]   List("a") did not contain all of ("a", "a.b") (SchemaInferenceEngineSpec.scala:200)
[info] - should still collapse a within-object literal-dotted-key vs nested-path collision to one field
[info] - should hold the three-sided agreement property on inputs where it already held pre-fix
[info] - should hold the three-sided agreement property on heterogeneous shapes and cross-row collisions (fix-dependent) *** FAILED ***
[info]   List("stats.a") did not contain element "stats.rec" (SchemaInferenceEngineSpec.scala:221)
[info] - should infer the full stats.rec* family from the live mixed-position Sleeper fixture *** FAILED ***
[info]   List(... 61 pre-fix field names, none of them stats.rec / stats.rec_yd / stats.rec_td ...) did not contain all of ("stats.rec", "stats.rec_yd", "stats.rec_td") (SchemaInferenceEngineSpec.scala:285)
[info] - should characterise the existing WR-only fixture's field-NAME set (unaffected by this ticket)
[info] - should pin the WR-only fixture's full field-by-field schema (name, type, nullable) *** FAILED ***
[info]   List(... 63 pre-fix triples, 4 of which differ from the pinned post-fix values (player.injury_body_part/player.injury_status nullable=false, stats.pts_half_ppr/stats.rec_fd IntegerType) ...) was not equal to List(... 63 pinned post-fix triples ...) (SchemaInferenceEngineSpec.scala:400)
[info] SchemaInferenceEngine.inferSchemaFromRows  (all 5 GREEN)
[info] SchemaInferenceEngine.fromCsv  (all 14 GREEN)
[info] SchemaInferenceEngine.displayName  (all 5 GREEN)
[info] DataFieldType.asString  (GREEN)
[info] JsonFlattenerSpec:  (all 11 GREEN)
[info] NestedJsonFlatteningSymmetrySpec:  (all 6 GREEN)
[info] SparkJobSubmitterSpec:
[info] loadDataFrame
[info] - should load a static DataSource into a DataFrame
[info] - should throw for unsupported rest_api source type
[info] - should does not truncate a fractional value when the declared column type is derived from SchemaInferenceEngine.fromJson (HEL-858 AC3) *** FAILED ***
[info]   "[integer]" was not equal to "[float]" (SparkJobSubmitterSpec.scala:128)
[info] applyStep  (all GREEN)
[info] collectRows  (GREEN)
[info] submit  (all GREEN)
[info] Run completed in 11 seconds, 291 milliseconds.
[info] Total number of tests run: 81
[info] Suites: completed 4, aborted 0
[info] Tests: succeeded 73, failed 8, canceled 0, ignored 0, pending 0
[info] *** 8 TESTS FAILED ***
```

After capturing this, the source diff was restored with
`git checkout HEAD -- backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala`;
the working tree is back to the fixed state, re-confirmed green
(`sbt -batch "testOnly com.helio.domain.engine.SchemaInferenceEngineSpec"` → 50/50 succeeded).
