# Evaluation Report — Cycle 1 (evaluation-1.md)

Ticket: HEL-970 · Change: preview-lane-aware-path · Commit `5af54ecf` (base `8bb88c0e`)

## Phase 1: Spec Review — PASS

Issues: none blocking.

- **AC1** — `PipelineRunServiceSpec:1724` previews rejoin `s4` whose `secondaryInput` is
  `Lane(s3)` where `s3` is a root-level sibling (not an ancestor); asserts `Right` + 4 rows.
- **AC2** — satisfied twice. (a) Row *content*: 2 rows carry `lane_b_flag = "lane-b"` and no
  `lane_a_flag`, 2 rows the inverse — `lane_b_flag` is a column only lane B produces, so the
  assertion is failable by any truncated slice. (b) Preview-vs-run equality (`:1751`) against an
  oracle that constructs a *fresh* `InProcessExecutionBackend`/`InProcessPipelineEngine` over the
  **full, un-sliced** step vector and reads `nodeOutcomes(StepKey(s4))`. The oracle shares the
  engine (correct — AC3 makes the engine the reference) but shares **none** of `previewStep`'s
  slicing, which is the code under test. Not vacuous.
- **AC3** — the slice is now literally `InProcessPipelineEngine.laneDependencyOf` + `parentStepId`
  to a fixed point (`NodeDependencyClosure.closureOf`), i.e. the engine's own edge set, sited in
  `com.helio.domain.engine` alongside the predicate. Divergences are stated in design.md D1/D3 and
  resolved in the engine's favour.
- **AC4** — the second copy at the former `:663` is *deleted*, not patched: both call sites now
  call the one helper. Verified by grep — no `pathToRoot` implementation survives anywhere in
  `backend/src/main/scala`. Backfill is covered behaviourally at `:1904` (asserts 4 persisted
  `node_snapshots` rows incl. 2 lane-B rows, so a swallowed `.recover` would fail).
- **AC5 (parity)** — the pre-existing trunk-plus-tails guards are untouched and green
  (`:1041-1078` positional-slice regression, `:1579` "tail step returns its own rows, not the
  trunk terminal"), plus `NodeDependencyClosureSpec`'s "for a parent-only chain, equals the old
  `pathToRoot` output exactly" whose expected `Vector("a","b","c")` is a literal derived from
  pre-change semantics, not from the new code. AC5 is met by pre-change-derived oracles.
- **AC6** — see Phase 2 "widening", independently re-verified and **stronger** than the executor's
  own evidence.
- **AC7** — diamond de-dup asserted on closure membership + `distinct` (`:1831` and unit spec);
  cyclic termination covered by the mutual-lane-reference unit test (halts, returns `{x,y}`).

Tasks: 32 `[x]`, zero `[ ]`. Planning artifacts match the implementation.
Scope: no change outside the two backend files + their tests + the change dir.

## Phase 2: Code Review — PASS

**Gates re-run by me, fresh, in the worktree (not trusting the executor's report):**

- `sbt -batch test` → `Tests: succeeded 3804, failed 0` / `Suites: completed 250, aborted 0` /
  `[success] Total time: 371 s`.
- Targeted re-run of `PipelineRunServiceSpec` + `NodeDependencyClosureSpec` → 74 succeeded, 0
  failed; all six new `HEL-970 lane-aware closure` tests and all seven
  `NodeDependencyClosure.closureOf` tests are named in the output (they really ran, not silently
  skipped).
- `node scripts/check-scala-quality.mjs` → clean (soft size warnings only, all pre-existing).
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`.
- `npx openspec validate preview-lane-aware-path --strict` → valid.
- Frontend gates: **N/A** — `git diff --name-only` shows zero `frontend/**` files.

**Hard constraints — all verified clean:**

- `backend/src/main/resources/db/migration/` — untouched (no path in the diff matches
  `migration`). No Flyway migration.
- No `frontend/**` file touched. No browser driven.
- Sibling-owned files untouched: `RestApiConnectorDriver`, `RestApiConfig`,
  `SchemaInferenceEngine`, `InProcessPipelineEngine` (the whole file — so
  `loadCsvRowsFromBytes` is not merely un-edited, the file it lives in is).
- `git status --porcelain` empty — nothing uncommitted skewing the gate run.

**Answers to the six discriminating questions asked of this review:**

1. Rejoin test asserts real row content, both lanes, right column on the right rows. Yes.
2. The equality oracle is independent of the slicing under test. Yes (see AC2 above).
3. Sibling-lane exclusion asserts on closure **membership**
   (`closure...toSet shouldBe Set(s1, s2)` plus `should not contain s3`), so the "just include
   every step" non-fix fails it statically, not merely on rows. Yes.
4. The cross-root test is genuinely DB-backed: `seedPipeline` inserts root 0 and `addSecondRoot`
   inserts a real `pipeline_roots` row at position 1, so `InProcessExecutionBackend.execute` takes
   the `else stepRepo.rootIdsOf(pipeline.id)` branch (two roots → the `roots.size == 1` shortcut
   cannot fire). No `PipelineStepRepository(null)` fixture anywhere in it. Root A and root B carry
   distinguishable data via the new `seedStaticDs` helper (`rootA-value` / `rootB-value`), and the
   assertion is a **row value** (`Vector(JsString("rootB-value"), JsString("rootA-value"))`) — the
   only signal the silent-corruption implementation produces. It was **not** downgraded to a
   single-root test. Additionally the rejoin sits on root B while root A is lowest-positioned, so
   the test also discriminates `TreeWalkResult.rows` vs `nodeOutcomes` behaviourally
   (`wrongRows should not be jsRows...`), satisfying task 3.4b as a real assertion rather than a
   code-shape one.
5. Diamond proves de-duplication (`distinct` + exact membership set); cyclic proves termination
   (mutual `Lane` references, closure returns and equals `{x,y}` — a non-terminating
   implementation hangs the suite rather than passing).
6. Parity expectations derive from pre-change behaviour (literal `Vector("a","b","c")` + untouched
   pre-existing preview tests), not from the new code.
7. `stepRowCounts` assertion is `response.stepRowCounts.get(s3.id.value) shouldBe Some(2L)` — a
   specific lane step id with its real count, failable against a filtered-back implementation. Not
   "the map grew".

**Widening (task 5 / AC6) — assessed independently, conclusion CONFIRMED and better-evidenced
than the executor's own argument.** The executor's evidence was a `parentStepId` grep plus a
per-site classification table, which is an argument-from-classification. I re-derived it from the
other end — the only thing that matters is *which call sites hand a non-full step vector to
`PipelineExecutionBackend.execute`*. Enumerating every `.execute(` call in
`backend/src/main/scala` yields exactly five in `PipelineRunService`: `:448` and `:648` pass
`Vector.empty` (full-pipeline execution), `:834` passes the full `steps`, and `:520` / `:664` are
the two sites this change fixed. No other site in the backend constructs an execution slice at
all, so "preview-only" is not just plausible, it is exhaustive. No missed site.
`PipelineAnalyzeService` was separately re-checked and is already parent+lane aware.
`RuntimeGraphPath`'s scaladoc/implementation divergence is correctly reported-not-fixed (D3) — it
feeds a display path, not execution.

**Code quality:** the helper is small, single-purpose, correctly sited next to the predicate that
defines it, and its scaladoc documents the four non-obvious rulings (ordering authority,
de-dup, termination, disabled-step non-filtering) with reasons rather than restatement. No
duplication left behind; no dead code; no `null`; no type escape hatches; no behaviour change at
either call site beyond the slice itself (both still pass the full `roots` vector per D5, both
still read `nodeOutcomes` with the existing fallback). Fix is minimal and behaviour-preserving
where it should be.

## Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` file changed (the only
`openspec/` edits are inside this change's own directory). Per the coordinator's constraint, no
browser was driven — the sibling run owns the shared Playwright session.

## Overall: PASS

## Change Requests

None.

## Non-blocking Suggestions

- `PipelineRunServiceSpec.scala:1789` and `:1917` contain tautological self-assertions
  (`(s1, s2, s3) shouldBe (s1, s2, s3)`, `(s3, s4) shouldBe (s3, s4)`) added to silence unused
  bindings. They can never fail and read as evidence-shaped non-evidence to a future reader.
  Prefer `_` in the tuple destructure (e.g. `val (pid, _, _, _, s4) = buildTwoLaneFixture()`) and
  delete the lines.
- `PipelineRunServiceSpec.scala:1770-1781` (preview/run agreement) compares only the
  `lane_a_flag`/`lane_b_flag` marker columns as a `Set`, which collapses 4 rows to 2 distinct
  tuples. Row *count* equality is asserted separately, so the test is sound, but including
  `name` (a plain string column, no JSON-numeric-encoding hazard) in the compared projection would
  make it discriminate wrong-row-pairing as well as wrong-lane-inclusion.
- `PipelineRunServiceSpec.scala` is now 1922 lines against a 250-line soft budget (pre-existing,
  and the check passes). Worth a future split ticket, not this one.
