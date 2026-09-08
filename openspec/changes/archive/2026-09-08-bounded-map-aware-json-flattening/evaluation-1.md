# Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `1c5edc44`, rebased onto `origin/main` @ `db51e936`.

## Rebase verification (requested first)

`git diff --stat origin/main..HEAD` = **exactly 22 files**: 5 backend main, 3 test resources, 5 test specs, 9 openspec
artifacts. Zero frontend files, zero keyboard-shortcut files. **The rebase is clean.** HEL-510's frontend-only change
carries no backend interaction, and I confirmed rather than inherited that: my own full `sbt test` on the rebased
commit is green (below).

---

### Phase 1: Spec Review — FAIL

| Item | Result |
| -- | -- |
| AC1 (one `players_points` column) | PASS — verified by test + my own run |
| AC2 (`drops` = one nullable StringType, zero `drops.<id>`) | PASS |
| AC3 (struct flattening preserved) | PASS |
| D2a outermost-wins, map-of-objects | PASS |
| D5 `drops` modelling | PASS |
| No migration / backfill | PASS — zero files under `db/migration`; HEL-1030 is real and Backlog |
| Scope creep | PASS — none |
| Planning artifacts reflect implementation | PASS |
| **Task 4.4 marked `[x]` but not implemented as specified** | **FAIL** |

Issues:

1. **Task 4.4 is marked done but its central requirement is not met** (detail + proof in Change Request 1). The task
   says, in its own words: *"EACH boundary fixture must pin BOTH conjuncts (coverage AND intersection) explicitly — a
   struct-side case that happens to have a non-empty intersection would pass for the WRONG REASON."* Exactly that
   failure is present in the shipped spec, and I proved it by mutation rather than by reading.

Everything else in Phase 1 checks out. Notably, the D2 provenance claim is **true**: I recomputed every row of
design.md's D2 table directly from the committed fixtures at `backend/src/test/resources/hel1015/` and every number
matches to three decimals:

```
matchups.json (12 rows)   players_points: union=173 coverage=0.083 intersection=0
tx.json (36 rows)         adds:  objrows=36 union=22 coverage=0.045 intersection=0
                          drops: objrows=17 nullrows=19 union=16 coverage=0.062 intersection=0
                          settings: objrows=22 nullrows=14 union=3  coverage=0.682 intersection=1
                          metadata: objrows=22 nullrows=14 union=1  coverage=1.000 intersection=1
projections-sample-200.json (200 rows)
                          stats:  union=52 coverage=0.580 intersection=16
                          player: union=14 coverage=1.000 intersection=14
```

This also independently confirms the RED arm was genuinely reachable pre-fix: 173 `players_points.<id>` keys, and 16
`drops.<id>` keys coexisting with 19 rows where `drops` is `null` (hence the bare `drops` column). Fixtures are real
Sleeper payloads, not hand-built.

### Phase 2: Code Review — FAIL

**Gates re-run by me, fresh, in `WORKTREE_PATH` (`CLEAN_WORKTREE` not set):**

- `sbt test` from `backend/` (NOT root `npm test` — this change touches no `frontend/**` file, so the frontend gates
  are correctly not applicable):
  ```
  [info] Total number of tests run: 4048
  [info] Suites: completed 272, aborted 0
  [info] Tests: succeeded 4048, failed 0, canceled 0, ignored 0, pending 0
  ```
  This reproduces the executor's post-fix number exactly, on the new base.
- `node scripts/check-scala-quality.mjs`: exit 0, "clean (161 soft warning(s))" — reproduces. I checked what this gate
  actually scans before citing it: hard rule = inline FQNs matching `FQN_PREFIXES`; the 161 warnings are file-size soft
  budgets only, and none are on files this ticket authored beyond the new spec.

**The binding invariant (schema ↔ rows ↔ preview) — verified by test and by compiler, not by reading:**

- The three-way key-set agreement test (4.5) passes on the real map fixture: schema field names == row key union ==
  preview key union.
- **`mapPaths` is genuinely REQUIRED.** I did the probe you asked for — compiled a file omitting it on all three entry
  points. All three fail to compile:
  ```
  not enough arguments for method leaves: (obj: JsObject, mapPaths: Set[String])...
  not enough arguments for method flattenJsObject: (obj: JsObject, mapPaths: Set[String])...
  not enough arguments for method jsRowToRow: (v: JsValue, mapPaths: Set[String])...
  ```
  D1's central compile-time guarantee is **TRUE as stated**, not aspirational.
- Grep of every `leaves(` / `flattenJsObject(` / `jsRowToRow(` call site: all three production consumers are
  batch-aware; every remaining single-argument call is a test using an explicitly-named `*Unclassified` variant.
  Task 3.4 is satisfied.
- Production wiring reads correctly against D6: `SourceService.previewRest:425` classifies over the full `jsRows` and
  only then `take(10)`. Correct — but unguarded; see Change Request 2.

**No test weakened to pass — confirmed by reading the whole diff of all four migrated specs.** Every hunk in
`JsonFlattenerSpec`, `SchemaInferenceEngineSpec`, `NestedJsonFlatteningSymmetrySpec` and `ExpressionEvaluatorSpec`
changes only the call expression (`leaves` → `leavesUnclassified`, `flattenJsObject` → `flattenJsObjectUnclassified`,
`jsRowToRow(x)` → `jsRowToRow(x, Set.empty)`). **Not one `shouldBe`, expected value, or assertion line differs.** This
is a clean signature migration, exactly as pre-authorised.

**Code quality:** DRY, readable, modular; the classifier is a single well-scoped function; thresholds are named
constants, not magic numbers; comments explain *why* and cite the design decisions. No dead code, no TODOs, no
over-engineering, no drive-by behavior changes. `MaxDepth`, the `ListMap` dedup policy and the global path sort are
untouched, and `detectMapPaths`' depth guard (`depth >= MaxDepth - 1`) is consistent with `walk`'s (`depth < MaxDepth - 1`),
so a path at the bound is never classified — as D2a requires.

Issues: see Change Requests 1 and 2 (both are guard-coverage defects, not production-logic defects).

### Phase 3: UI Review — N/A

No trigger matched. Changed files are `backend/src/**` and `openspec/changes/**` only — no `frontend/**`, no
`ApiRoutes.scala`, no `schemas/**`, no `openspec/specs/**`. No dev servers started.

### Overall: FAIL

The production implementation is faithful to the confirmed design and, as far as I could measure it, correct. Both
findings are in the **guard tests**, which is where you predicted a silent defect would be — and both are
mutation-proven, not asserted.

---

## Resolving the discrepancy in the executor's report (your priority 1)

**The real number is 3, and the "BOTH" phrasing is wrong.** Establishing each part:

- **Count.** files-modified.md's own pasted transcript is primary and says `failed 3`, and its prose enumerates three:
  one token-expiry test ("consume() itself refuses a token that expired AFTER being read as live") *plus two*
  expiry-recovery re-mint tests. The "BOTH … failures" wording is a prose slip contradicted by the transcript
  immediately above it, not a second measurement.
- **Which suite.** All 3 were in one suite: `com.helio.services.sources.ConnectorCompletionServiceSpec`. The `[error]
  Failed tests:` block names that suite and no other.
- **Arithmetic corroborates the baseline.** 4031 baseline + 17 new = 4048, and my independent full run measured
  exactly 4048 tests in 272 suites. The claimed baseline total is consistent with a real run.
- **Is "flaky" genuine, or is it hiding a defect from this change?** I did not take it on assertion. I created a
  throwaway worktree detached at `origin/main` (`db51e936`) — containing **zero** HEL-1015 code — and ran that spec
  three times: `18 tests, 0 failed` on all three. I also ran the full suite at HEAD: 4048/4048, that suite green.

  **Conclusion: the failures are provably not caused by this change.** The suite is green both with and without the
  HEL-1015 diff, and the change's blast radius is disjoint from it — `ConnectorCompletionServiceSpec` exercises no
  code path through `JsonFlattener`, `PipelineRowJson`, `SchemaInferenceEngine.inferFromObjects` or
  `SourceService.previewRest`, and the diff touches no file it loads.

  **Stated honestly:** I did not reproduce the failure itself, so "timing-flaky" is *corroborated* (a time-sensitive
  token-expiry suite that passes clean on the unmodified base) rather than *proven*. What is proven is the
  load-bearing claim — not this change's doing. This does not block. If you want the flake itself nailed down it is a
  separate concern about that suite, not about HEL-1015.

## Change Requests

### 1. [BLOCKING, plan-required] The 0.25 threshold has no struct-side guard — every struct assertion currently passes by the intersection conjunct alone, which is the "wrong reason" task 4.4 forbade by name

I re-ran the mutation proof myself rather than trusting the transcript, and ran a second mutation the executor did not.

- **Mutation A — threshold `0.25` → `0.0` (the executor's):** reproduces exactly. `Tests: succeeded 7, failed 10`.
  The pasted transcript is accurate.
- **Mutation B — threshold `0.25` → `0.99` (mine):** **`Tests: succeeded 17, failed 0. All tests passed.`**

Mutation B is the defect. A threshold of 0.99 means *every* multi-row object path with an empty intersection is
classified MAP — including near-misses that should stay structs — and **not one of the 17 guard tests notices.** The
threshold is guarded in one direction only (too low) and completely unguarded in the other (too high).

The cause is exactly what task 4.4 warned about. The struct-side test

```scala
"classify settings/metadata (tx.json) and stats/player (projections) as STRUCT: non-empty intersection" in {
  JsonFlattener.detectMapPaths(txRows) should not contain "settings"
  ...
```

is *titled* "non-empty intersection" but its body **measures neither conjunct**. Every struct in the suite has a
non-empty intersection, so every struct-side assertion is carried entirely by the intersection clause and proves
nothing about the coverage threshold it exists to test. `stats` — design.md's designated load-bearing near-miss at
coverage 0.580 — is protected today by intersection 16, not by the threshold. Relatedly, task 4.4's requirement to pin
the D2 table's per-field numbers is unmet: only `players_points` asserts a conjunct at all, and only as `< 0.25`
rather than ≈0.083.

**Required change**, in `backend/src/test/scala/com/helio/domain/engine/MapAwareJsonFlatteningSpec.scala`:

a. In the struct-side D2-table test, measure and assert **both** conjuncts per field, as task 4.4 requires — for
   `settings` (0.682 / 1), `metadata` (1.000 / 1), `stats` (0.580 / 16), `player` (1.000 / 14). Use the same
   `coverage` / `intersection` computation the `players_points` test already does. All values are reproducible from
   the committed fixtures (my recomputation above matches design.md exactly, so pin the real numbers with a tolerance,
   not inequalities alone).
b. Add at least one struct-side case whose STRUCT classification depends on the **coverage** conjunct — i.e. an
   empty-intersection payload with coverage comfortably *above* 0.25 that must classify STRUCT. Without such a case
   the threshold is untestable in the direction that silently collapses real columns.
c. Re-run the mutation with the threshold raised (e.g. `0.99`), not only lowered, and paste that transcript. The guard
   is only failable-by-mutation once (b) exists; today it is not.

### 2. [BLOCKING, defence-in-depth] D6's ordering — the trap the design names — is implemented correctly but has zero regression guard

The implementation at `SourceService.scala:425` is right. To check whether anything *holds* it right, I mutated it to
the wrong ordering the design explicitly warns against:

```scala
val mapPaths = JsonFlattener.detectMapPaths(jsRows.take(10).collect { case o: JsObject => o })
```

and ran the **full** backend suite: `Total number of tests run: 4048 … succeeded 4048, failed 0`.

The single line design.md D6 calls "the trap" can be silently reverted and the entire suite stays green. The 4.5
agreement test cannot catch this because it constructs one `mapPaths` and hands the same value to all three
flatteners — it verifies the three *flatten* consistently given identical input, not that the three *production
consumers compute* identical input, which is the actual D6 risk.

**Required change:** add a test that exercises `SourceService.previewRest` (or its extracted seam) with **more than
10 rows**, shaped so classification over the full batch differs from classification over the first 10 — e.g. a
map-shaped field whose first 10 rows coincidentally share a key while the full batch does not. Assert the preview key
set matches the inferred schema's field-name set. Confirm the test is red under the `take(10)` mutation above.

## Non-blocking Suggestions

- `SchemaInferenceEngineSpec.scala:285` — `assertAgreement` now calls `jsRowToRow(_, Set.empty)` on a **multi-row**
  `Seq[JsObject]` while its schema side (`fromJson`) computes real `mapPaths`. This is a legitimate part of the
  pre-authorised migration and passes today, but it quietly weakens that helper: it can no longer detect a schema/row
  divergence for any map-shaped input. Consider having it compute `detectMapPaths(rows)` and pass that, so the helper
  keeps testing the invariant its name claims. (`NestedJsonFlatteningSymmetrySpec`'s `Set.empty` is fine — those are
  genuinely single-row calls where D3 defaults to struct anyway.)
- `JsonFlattener.scala:76` introduces the inline fully-qualified `scala.collection.mutable.Set.empty[String]`.
  `scala.collection.` is not in `check-scala-quality.mjs`'s `FQN_PREFIXES`, so the gate does not catch it, but
  CONTRIBUTING.md:70's rule is general. `import scala.collection.mutable` at the top and `mutable.Set` at the use site
  reads better and sidesteps the clash with the imported `Set`. Local precedent (the pre-existing inline
  `scala.collection.immutable.ListMap` in the same file) makes this defensible, hence non-blocking.
- Test 4.5 passes under both threshold mutations. That is correct and expected — it guards divergence, not
  classification — but a one-line comment saying so would stop a future reader mistaking it for classifier coverage.

## Guardrail checks

- **HEL-1009 remains disjoint.** `SchemaInferenceEngine.inferShallowFromJsObjects` (HEL-891's shallow-union path) is
  untouched; the diff in that file is confined to `inferFromObjects`. `PipelineAnalyzeService.scala` is not in the
  22-file diff at all.
- **HEL-1012 / 1013 / 868 / 869 / 891 / 599 not absorbed.** The diff stays inside the
  inference / materialisation / preview triad. `MaxDepth`, the dedup/`ListMap` policy and the global path sort are
  unchanged (HEL-599/858 territory left alone). No sample cap (HEL-869), no absence-nullability change (HEL-868), no
  row-0 inference change (HEL-891) crept in.
- **No migration or backfill.** Zero files under `backend/src/main/resources/db/migration/`. **HEL-1030 is a real
  filed ticket** (Backlog, "Remediate persisted source schemas carrying the unbounded map-keyed column set"), so the
  deferral is owned rather than merely asserted.
- **No interaction requiring a fix here was found.**

## Method note

Per the never-modify-code guardrail, every mutation above was executed in throwaway `git worktree --detach` copies
under the session scratchpad, never in the delivery worktree. Both were removed with `git worktree remove --force`
and `git worktree prune`; `git status --porcelain` in the delivery worktree is empty and `git worktree list` shows no
straggler of mine.
