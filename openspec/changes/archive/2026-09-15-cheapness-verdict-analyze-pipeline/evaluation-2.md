## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 123bc1d80870a5ef22560e062018b9fe93a1f83c
Prior commit: 15ab89d5d1694737ad925b794fbea3f9b3ba1f16 (evaluation-1.md, PASS)

This cycle's diff is scoped entirely to addressing `skeptic-final-1.md`'s three change requests
against the cycle-1 code. No frontend/UI files changed this cycle, so Phase 3 is not re-triggered
(prior PASS from cycle 1 stands, unaffected by this diff).

### Phase 1: Spec Review — PASS

- New Standing Constraint C4 (tasks.md): "CheapOps is a hand-maintained literal; a test fails when
  a registered op is in neither CheapOps nor a named deny set." Honored: `CheapOps` is now a literal
  `Set[String]` (23 ops, matching the exact set skeptic-final-1.md CR1 proposed), and
  `PipelineCostEstimatorSpec`'s new "op coverage" describe block asserts the partition invariant
  directly.
- All three skeptic change requests addressed:
  - **CR1** (hand-maintained literal, not derived from `Registry.keySet`): done, `PipelineStep`
    import removed from the estimator since it's no longer referenced there.
  - **CR2** (replace the tautological D2 test with a real tripwire + regression): done — the old
    `CheapOps shouldBe (Registry.keySet - "upsertsource")` assertion is gone, replaced by a
    completeness/partition test and a "registered-shaped op present in none of the three sets is
    denied" regression.
  - **CR3** (fix the now-inaccurate comment and design.md D2): done — both the code comment
    (`PipelineCostEstimator.scala:30-36`) and design.md D2 now correctly describe the hand-maintained
    mechanism and the real tripwire, no longer claiming a derived formula "denies until someone
    classifies it."
- tasks.md 4.2/4.3 updated to describe the new spec shape and M3; both marked done and match the
  diff.
- No scope creep — diff is confined to the estimator, its spec, and planning-artifact updates
  (design.md, tasks.md, mutation-evidence.md, files-modified.md) plus the skeptic/evaluator report
  artifacts themselves.
- No regressions: full backend suite green (see Phase 2).

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH`:

- `sbt test` (full suite): **4373/4373 passed** (up 1 net test from cycle 1's 4372, consistent with
  the "17 tests, up from 16, 1 tautological test replaced by 2 new ones" arithmetic in
  `mutation-evidence.md`), 0 failed (4m36s).
- `npm run check:schemas`: clean, 0 drift — unaffected by this backend-only diff, re-confirmed
  anyway.
- No frontend/helio-mcp files touched this cycle; cycle-1's lint/format/typecheck/build/Jest runs
  already covered the current frontend/helio-mcp tree and remain valid (nothing in this cycle's
  diff touches those surfaces).

Standing Constraints:
- **C1**: unaffected by this diff — `CostVerdict`'s private-constructor derivation is unchanged.
- **C2**: independently re-ran M1 and M2 myself against the new code shape (not trusting
  `mutation-evidence.md`), see Mutation re-verification below — both reproduced the claimed RED
  output exactly, including the shifted line numbers/messages from the new "op coverage" tests
  being present.
- **C3**: unaffected — `analyzewithai`/`generatetext`/`convertformat` remain unimplemented/
  unregistered; `convertformat` continues to be classified purely by absence from all three sets.
- **C4 (new)**: independently re-ran the mandated mutation (M3: remove `"filter"` from the literal
  `CheapOps`) myself — reproduced the claimed RED output exactly (2 failures: the partition test
  naming `filter` directly, plus the pre-existing allow-case regression that uses `filter` as its
  one allowlisted step).

Mutation re-verification (independent, not trusting the executor's report), all against
`sbt "testOnly com.helio.domain.engine.PipelineCostEstimatorSpec"`:

- **Baseline** (before any mutation): 17/17 green.
- **M1** — removed the `AiOps.contains(step.op)` branch from `classifyStep`. Result: **3 of 17
  failed** — same three assertions/line numbers as `mutation-evidence.md` (`ai-step` assertions
  fail via `unclassified-op` fallback; the new "op coverage" tests are correctly unaffected, narrow
  blast radius as claimed). Reverted via `git checkout --`; `git status` clean; re-ran: 17/17 green.
- **M2** — added `"analyzewithai"` to the literal `CheapOps` and removed the AI-deny branch.
  Result: **4 of 17 failed** — matches claimed output exactly, including the new partition test
  failing independently (`HashSet("analyzewithai") was not empty`). Reverted; `git status` clean;
  re-ran: 17/17 green.
- **M3 (C4's mandated target)** — removed `"filter"` from the literal `CheapOps`. Result: **2 of 17
  failed** — matches claimed output exactly: the partition test names `Set("filter")` directly, and
  the pre-existing allow-case test (which uses `filter` as its single allowlisted step) fails as an
  independent second signal. Reverted; `git status` clean; re-ran: 17/17 green.

This directly demonstrates the fix closes the gap skeptic-final-1.md identified: under the cycle-1
derived formula, an equivalent "delete a Registry op from CheapOps" mutation was impossible to even
express (CheapOps was computed, not edited), and the old D2 test was tautological against that same
formula. Now CheapOps is edited directly and the partition test catches its removal.

Other checks (delta from cycle 1 only):
- **Readable**: the new code comment explicitly explains why a derived formula was rejected — good,
  addresses the reviewer's "why not just derive it" question directly.
- **DRY/Modular/Type safety/Error handling**: unaffected by this narrow diff; cycle-1's assessment
  stands.
- **No dead code**: `PipelineStep` import removed from `PipelineCostEstimator.scala` since it's no
  longer referenced (confirmed via diff — clean removal, not a stray unused import left behind).

### Phase 3: UI Review — N/A (unchanged from cycle 1)

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files changed in this
cycle's diff (15ab89d5..123bc1d8). Cycle 1's Phase 3 PASS (live server check, zero console errors,
well-formed `costVerdict` in a real API response) remains the operative UI evidence and is
unaffected by this backend-only change.

### Overall: PASS

### Non-blocking Suggestions

- None.
