# Files modified — HEL-858

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` — deleted
  `mergeObjects`/`flattenObject`; replaced with `inferFromObjects` (flatten-then-merge over
  `JsonFlattener.leaves` paths, per-path accumulator of widened type + nullable) and the new
  `widenJson` lattice (design D1/D2/D3/D4).
- `backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala` — comment-only fix (task
  1.5): the scaladoc contract block's dangling reference to the now-deleted `mergeObjects` is
  updated to name `inferFromObjects` instead. No traversal/behavior change.
- `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala` — new `[RED]`
  tests for order-independence (3.1, cycle 3: strengthened with a pinned content assertion so a
  degenerate/empty implementation cannot pass), nested-field position-independence (3.2), the
  widening lattice (3.3), the D5 cross-row leaf-vs-subtree collision (3.6), and the fix-dependent
  half of the three-sided agreement property (3.8b) and the live Sleeper regression (3.9); new
  `[CHAR]` tests for all-null nullability (3.3b), absence-not-nullable (3.5), the within-object
  collision (3.7), and the pre-fix-safe half of the agreement property (3.8a). Task 3.10 is split
  (cycle 3, evaluation-2.md CR1) into **3.10a** `[CHAR]` (field-NAME set only, genuinely green
  both ways) and **3.10b** `[RED]` (the full pinned `(name, type, nullable)` triple for all 63
  fields, self-enforcing rather than attested, necessarily red on revert).
- `backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala` — new `[RED]` end-to-end
  truncation test (3.4): declares a `StaticSource` column type from
  `SchemaInferenceEngine.fromJson` over rows containing `3` then `2.5` and asserts the fractional
  value survives `SparkJobSubmitter.loadDataFrame`.
- `backend/src/test/scala/com/helio/domain/engine/NestedJsonFlatteningSymmetrySpec.scala` —
  comment-only fix (task 1.5): updates the dangling prose reference to the deleted
  `mergeObjects`/`withNulls` residual to describe the current `inferFromObjects` behaviour.
  **Cycle 3 fix** (evaluation-2.md Finding B): a follow-on clause claiming the per-row equality
  symmetry property now holds "across a whole heterogeneous array too" was false under that exact
  equality relation (design D6 says a whole-array equality assertion fails a correct
  implementation, since the schema legitimately carries fields no single row has). Corrected to
  state the per-row scope is unchanged and point at `SchemaInferenceEngineSpec`'s
  `assertAgreement` tests (3.8a/3.8b) for the whole-array property that DOES hold (D6's
  subset+union+no-duplicates).
- `backend/src/test/resources/hel858/sleeper-mixed-projections-slice.json` — new fixture: a
  verbatim 15-element slice of the live Sleeper mixed-position projections endpoint (task 2.1),
  captured 2026-08-28T19:05:50Z, provenance in `evidence/live-probe-transcript.md`.
- `openspec/changes/recursive-merge-type-widening/evidence/live-probe-transcript.md` — new
  (task 2.2): fetch command, timestamp, checksum, and a manual spot-check of the fixture's
  adequacy property.
- `openspec/changes/recursive-merge-type-widening/evidence/red-verification.md` — new (task
  3.11), **regenerated in cycle 3** (evaluation-2.md Finding A): cycle 2's strengthening of task
  3.10 moved it from characterisation to red-on-revert without a fresh revert run, leaving the
  committed transcript describing a suite that no longer existed. Re-ran the revert for real
  after the 3.10a/3.10b split; now shows **73 succeeded, 8 failed** — the original 7 `[RED]`
  tests plus 3.10b — and every currently-`[CHAR]`-classified test confirmed green.
- `openspec/changes/recursive-merge-type-widening/evidence/wr-fixture-characterisation.md` — new
  (cycle 2, CR1): task 3.10's required field-by-field comparison of the WR-only fixture's
  pre-fix vs post-fix schema. Two fields (`player.injury_body_part`, `player.injury_status`)
  flip `nullable false → true` (type unchanged) — classified as neither legitimate widening nor a
  D7 null-rule flip, but the unchanged D2 rule reaching a nested path for the first time. Two
  more (`stats.pts_half_ppr`, `stats.rec_fd`) widen `integer → float` — legitimate.
- `openspec/changes/recursive-merge-type-widening/tasks.md` — all tasks checked off except 4.4
  (spec archive, deferred to the delivery/archive phase).
