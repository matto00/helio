## 1. Red baseline (before any fix)

- [x] 1.1 Add a ScalaTest fixture built from the REAL staged payload `.hel1015-realdata/matchups.json` (12 rows) and confirm the RED arm is reachable: current inference emits 170+ `players_points.*` columns; paste the observed count
- [x] 1.2 Add a RED fixture from `.hel1015-realdata/tx.json` confirming `drops` today yields BOTH a `drops` string column AND `drops.<id>` columns; paste both
- [x] 1.3 Record the full backend baseline: `sbt test` from `backend/`, pass/fail counts pasted

### Backend

## 2. Classifier

- [x] 2.1 Add `JsonFlattener.detectMapPaths(objects: Seq[JsObject]): Set[String]` implementing the COMPOUND rule D2: MAP iff `coverage < 0.25` AND `intersection` is empty AND `>= 2` object-rows, else STRUCT (D3). The intersection conjunct is what rejects the variant-payload counterexample — do not drop it
- [x] 2.1a Implement D2a's recursion rule: OUTERMOST-WINS (no path beneath a MAP path is classified or emitted), denominator is PARENT-PRESENT rows, and a path at `MaxDepth` is never classified
- [x] 2.2 Make `leaves(obj: JsObject, mapPaths: Set[String])` the production traversal with `mapPaths` REQUIRED — no default and NO same-named single-arg overload (D1/CR2: an overload lets a missed consumer compile silently, which is the divergence this design calls its worst risk). A path in `mapPaths` is a LEAF carrying the object itself (D4), exactly as `JsArray` is treated
- [x] 2.2a Apply the SAME required-parameter rule to `flattenJsObject` (design gate r2 CR1) — it is how the preview consumer at `SourceService.scala:421` calls in, so a single-arg version would let that consumer compile while silently flattening maps
- [x] 2.2b Give test-only / genuinely-single-object callers separately NAMED unclassified variants for BOTH entry points so every unclassified call is explicit and greppable by name; verify production code cannot omit `mapPaths`
- [x] 2.3 Verify `MaxDepth`, the `ListMap` dedup policy and the global path sort are unchanged — these are load-bearing for other tickets and must not drift

## 3. Wire the three consumers (D1/D6 — all three, or none)

- [x] 3.1 `SchemaInferenceEngine.scala:113` — compute `detectMapPaths(objects)` once in `inferFromObjects` and pass to every `leaves` call
- [x] 3.2 `PipelineRowJson.scala:100` / `InProcessPipelineEngine.scala:647,655` — classify over the FULL `outcome.rows` batch, then map `jsRowToRow` with that set. `jsRowToRow` GAINS an explicit `mapPaths` parameter and passes it through; it must NOT compute classification internally — per-row classification is impossible in principle (Context 1) and would make rows disagree with the schema row by row
- [x] 3.3 `SourceService.scala:421` — call `detectMapPaths` over the FULL `jsRows` and only THEN `take(10)` for display (D6: ordering, not logic). Classifying over the 10 displayed rows would re-create the three-way divergence its own comment warns about
- [x] 3.4 Grep for any remaining `JsonFlattener.leaves(` / `flattenJsObject(` call site and confirm each is either batch-aware or deliberately left single-arg with a stated reason

## 4. Verify the acceptance criteria

- [x] 4.1 AC1 — the matchups fixture now yields ONE `players_points` column; assert the exact post-fix column list, not just a count
- [x] 4.2 AC2 — the transactions fixture yields exactly one `drops` column, `StringType`, `nullable = true`, and ZERO `drops.<id>` columns (D5)
- [x] 4.3 AC3 — struct flattening preserved: assert `stats.*` and `player.*` still flatten using the STAGED `.hel1015-realdata/projections-sample-200.json` (200 real rows), and that `settings.*` / `metadata.*` still flatten from `tx.json`. Load-bearing for the prod Sleeper boards — verify, do not assume
- [x] 4.4 AC5 near-miss — fixtures pinning the D2 table on real staged data: `stats` 0.580/int 16, `settings` 0.682/int 1, `metadata` 1.000/int 1, `player` 1.000/int 14 on the STRUCT side; `players_points` 0.083/int 0, `drops` 0.062/int 0, `adds` 0.045/int 0 on the MAP side; plus a synthetic case just either side of 0.25 so the boundary itself is exercised. EACH boundary fixture must pin BOTH conjuncts (coverage AND intersection) explicitly — a struct-side case that happens to have a non-empty intersection would pass for the WRONG REASON (classified STRUCT by intersection, not by coverage) and would prove nothing about the threshold it exists to test
- [x] 4.4a Pin the VARIANT-PAYLOAD counterexample (CR4): ~10 variants of ~4 fields sharing one `type` discriminator measures coverage 0.122 (below threshold) but intersection 1, and MUST classify STRUCT. This is the case coverage alone gets wrong — assert it directly
- [x] 4.4b Add a fixture for a MAP whose values are OBJECTS, asserting D2a outermost-wins: one leaf, no paths emitted beneath it
- [x] 4.4c Pin the struct-side residual (r2 CR3): take 4.4a's variant payload, delete the discriminator from ONE row, and assert the classification flips STRUCT -> MAP. This is an accepted limitation — assert it so it is deliberate and visible, not incidental. Recompute the exact coverage for the fixture's real arity rather than copying 0.122/0.1195
- [x] 4.5 **Schema/row agreement (the binding HEL-599 invariant)** — a test asserting the inferred column set EQUALS the materialised row's key set for the map fixture, AND equals the PREVIEW surface's key set (all three, not two): preview is the surface D6 calls the trap, so leaving it out of the agreement assertion tests the one consumer least likely to fail while skipping the one most likely to. Note the VALUE rendering legitimately differs (preview returns a nested `JsObject`, `jsRowToRow` renders compact JSON text — the existing `JsArray` precedent); assert KEY SETS, not values. This is the invariant a half-fix would break; it must be a real assertion, not a comment
- [x] 4.6 AC4 mutation proof — flip the threshold so maps classify as structs, confirm 4.1/4.2 go RED, restore, paste both transcripts; label as a guard

## 5. Gates

- [x] 5.1 `sbt test` from `backend/` fully green; paste counts against 1.3's baseline so the classifier's blast radius across the existing suite is MEASURED, not assumed. `JsonFlattenerSpec` (~10 `leaves(obj)` sites), `SchemaInferenceEngineSpec:68`, and `NestedJsonFlatteningSymmetrySpec` (5 `jsRowToRow` sites) will ALL break under the required-parameter change — this enumeration is known-incomplete, so rely on task 3.4's grep to find the rest: migrating them to the named unclassified variant is a SIGNATURE MIGRATION, not a test weakened to pass — state that explicitly in files-modified.md, and do not change any test's ASSERTIONS to make it pass
- [x] 5.2 Scala code-quality/lint gates clean; confirm what each gate actually scans before citing it as evidence
- [x] 5.3 Decide `.hel1015-realdata/` deliberately: it now holds `matchups.json`, `tx.json` and `projections-sample-200.json` (200 real rows, ~266 KB), and design.md D2's table is stated as reproducible FROM THESE FILES. Either commit them as the fixtures' real-data source with a note, or inline the needed payload into fixtures AND re-state D2's provenance — do not leave the design citing files the repo does not carry (design gate r1 CR1)

## 6. Delivery

- [x] 6.1 Rebase onto latest `main`; re-run 5.1 if backend files moved
- [x] 6.2 PR body states the heuristic and its measured margin, the D5 `drops` modelling decision, the D7 residual, and that HEL-1030 owns remediation
