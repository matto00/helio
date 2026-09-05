## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold verification against merge-base `8bb88c0e` (NOT `main`, which has advanced to
`a7b047e8` via a sibling merge). Two commits under review: `5af54ecf`, `53426f70`.

### What I verified (with evidence)

**1. Round-1 mutant is genuinely dead — reproduced by executed mutation, not by reading.**

I re-derived the round-1 mutant myself and applied it to
`backend/src/main/scala/com/helio/domain/engine/NodeDependencyClosure.scala`: a `closureOf`
that tracks a `laneDiscovered` set and, for any node reached via a lane edge, follows its
lane edges but **not** its `parentStepId` edge. `sbt "testOnly ...NodeDependencyClosureSpec
...PipelineRunServiceSpec"` under the mutant:

```
Tests: succeeded 71, failed 4
- should follows parent edges FROM a lane-discovered node that itself has a multi-step
  ancestor chain *** FAILED ***
  Set("a", "laneTip", "join") was not equal to
  HashSet("laneRoot", "join", "a", "laneTip", "laneMid")
  (NodeDependencyClosureSpec.scala:52)
- should backfill (evaluateNodeRowsForBackfill) ... *** FAILED ***
  Vector() had size 0 instead of expected size 4 (PipelineRunServiceSpec.scala:1936)
  (+ 2 further PipelineRunServiceSpec failures)
```

The mutant that passed the entire round-1 suite now fails in **four** places, at both the
unit level and end to end through the service. CR1 is discharged with executed evidence.
Implementation restored byte-for-byte from a pre-mutation copy; `git status --porcelain` is
empty, so nothing I did leaked into the tree.

I also re-derived the other plausible wrong `closureOf` variants and confirmed each is
killed by an existing assertion: lane edges followed only one hop (killed by "follows a
transitive lane edge"), lane edges followed only from the target itself (same test),
include-everything (killed by "excludes a sibling lane…", asserted on closure *membership*
in both specs), no de-dup (killed by the diamond test's `distinct` assertion), re-ranking
the output (killed by the deliberately out-of-order "emits the closure in the input
vector's own order" test), non-termination on a cycle (killed by the cyclic-lane test).
I could not construct a plausible surviving wrong implementation.

**2. The service-level tests assert the lane tip's ANCESTOR, not merely the tip.**

`buildTwoLaneFixture` (PipelineRunServiceSpec:~1707) builds lane B as `s3a` (parentless,
adds `lane_b_flag` = `"lane-b"`) → `s3b` (parent = `s3a`, adds `lane_b_flag2` =
`"lane-b-2"`), with `s4`'s `SecondaryInput.Lane` pointing at **`s3b`**. Every consuming
test asserts `s3a`'s own marker column, not only `s3b`'s:
- "previewing the rejoin (s4)…": `laneBRows` is selected *by* `lane_b_flag == "lane-b"`
  (s3a's effect) and each row additionally asserted to carry `lane_b_flag2`; `stepRowCounts`
  asserted `Some(2L)` for **both** `s3a.id` and `s3b.id`.
- "preview/run agreement…": the marker triple set is pinned to exactly
  `{(lane-a,None,None), (None,lane-b,lane-b-2)}` — s3a's value is a required member.
- backfill test: persisted `node_snapshots` rows filtered on `lane_b_flag == "lane-b"`.
No test would pass with s3a omitted. The hole one level up is closed.

**3. Round-1 clean findings re-confirmed clean after the fixture rewrite.**
- Cross-root test still DB-backed and still distinguishable: new `seedStaticDs` seeds root A
  with `"rootA-value"` and root B with `"rootB-value"`; the assertion is on row *values*
  (`Vector(JsString("rootB-value"), JsString("rootA-value"))`), plus a
  `wrongRows should not be jsRows` discriminator proving rows come from
  `nodeOutcomes(rejoin)` and not `TreeWalkResult.rows` (root A's terminal frame).
- Preview/run oracle still independent: it constructs its own
  `InProcessPipelineEngine` + `InProcessExecutionBackend` over the **full, un-sliced** step
  vector and reads `nodeOutcomes(StepKey(s4))` — it never touches `previewStep`'s slicing.
- Sibling-lane exclusion still asserted on closure membership
  (`closure.map(_.id.value).toSet shouldBe Set(s1, s2)` plus explicit `not contain` for both
  s3a and s3b), not merely on rows.
- Diamond de-dup (`distinct` + exact set) and cycle termination intact in
  `NodeDependencyClosureSpec`; the diamond is additionally exercised end to end.

**4. Acceptance criteria traced.**
- AC1/AC2 — "previewing the rejoin (s4) returns 200…" and "preview/run agreement…" tests.
- AC3/AC4 — `git diff` shows both `pathToRoot` copies (`previewStep`,
  `evaluateNodeRowsForBackfill`) deleted and replaced by
  `NodeDependencyClosure.closureOf(...)`; no third traversal survives.
- AC5 (single-lane parity) — I verified the argument rather than accepting it:
  `InProcessPipelineEngine.laneDependencyOf` (`:114-119`) returns `None` for every op except
  `JoinStep`/`UnionStep`/`LookupStep` with `SecondaryInput.Lane`, so on a lane-free graph
  `closureOf` provably reduces to the ancestor chain. The two pre-existing *discriminating*
  tests cited both exist and are green (`PipelineRunServiceSpec:1046` "…excluding an
  unrelated tail (AC5.5)", `:1579` "previewStep on a tail step returns the tail's own rows").
- AC6 — widening sweep in `files-modified.md` re-derived from a `parentStepId` grep with a
  per-site classification; `PipelineAnalyzeService` confirmed already lane-aware,
  `RuntimeGraphPath.pathOf`'s scaladoc/impl divergence reported-not-fixed with a stated
  reason. Answer given with evidence, as the AC requires.
- AC7 — diamond + cycle tests above.

**5. Full suite, run by me.** `sbt test` in `backend/`:
`Total number of tests run: 3805 / Suites: completed 250, aborted 0 /
Tests: succeeded 3805, failed 0 ... [success] Total time: 311 s`.
**I did not see the executor's reported `AssistantConversationRoutesSpec` flake** — that
suite passed in my run. I make no claim that this change caused it; nothing in the diff
touches the assistant/conversation path.

**6. Hard constraints re-confirmed against `8bb88c0e`.** `git diff --name-only
8bb88c0e..HEAD` is 15 files: 2 backend main, 2 backend test, 11 under
`openspec/changes/preview-lane-aware-path/`. A grep of that list for
`db/migration|frontend/|RestApiConnectorDriver|RestApiConfig|SchemaInferenceEngine` returns
nothing. No Flyway migration, no frontend change, no sibling-owned file. No browser driven,
no `cleanup.sh`, no push, no merge.

**7. UI/design judgment: N/A** — zero `frontend/**` files in the diff, so `DESIGN.md` does
not bind here.

### Verdict: CONFIRM

### Non-blocking notes

- No test exercises a lane-discovered node whose *ancestor* itself holds a lane reference
  (mixed parent-then-lane at depth ≥ 3). The shipped implementation is a uniform
  visited-set fixed point over the union of both edge kinds, so this case cannot behave
  differently from the covered ones — but a future refactor that special-cases edge kinds
  would not be caught. Cheap to add if the file is ever touched again.
- `files-modified.md` documents AC5 as resting on two pre-existing tests rather than a new
  one. That is honest and the reduction argument is sound; worth keeping the explicit note
  so a later reader does not mistake the absence of a new AC5 test for an absence of
  coverage.
