## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: d01c3a71c7f073b38cbc3f399178e8a2946c7871. Diff base, resolved live with `resolve-review-base.sh` (exit 0): c26c3056785e7a5a1d7a33508a039aa66b24a5a1.

### What I verified (with evidence)
- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rollup-spec-clock-independent/HEL-1247`.
- **Scope (AC4):** `git diff --stat BASE...HEAD` shows one code file, `backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala` (+30/-10). Everything else is openspec artifacts. There are no production, harness, migration or V114 changes.
- **Independent reproduction.** I ran every variant in a scratch copy of HEAD's `backend/` (`git archive HEAD backend`), so the worktree was never modified. Each run used `nice -n 19 sbt -batch "testOnly com.helio.services.telemetry.ProductEventRollupServiceSpec"`, and every log lists all 7 test names plus a fresh "Run completed" timing, so none of them was a cache no-op. Results:

  | Variant | Spec | Result |
  |---|---|---|
  | base | unmodified spec | green, 7/7 |
  | A, the red | unmodified spec + `newUser(); newUser(); newUser()` at the top of the "roll up in ONE tick" body, wall clock 2026-10-08 | **`404 was not equal to 407 (ProductEventRollupServiceSpec.scala:112)`**, exit 1 |
  | head | HEAD spec | green, 7/7 |
  | B | HEAD spec + the same 3-`newUser()` probe | green, 7/7 |
  | B-tz | B under `TZ=Pacific/Kiritimati` plus `-Duser.timezone=Pacific/Kiritimati` | green, 7/7 |
  | D, the mutation | HEAD spec with Decision 2 reverted (whole-table `otherUsers` restored at `:116/:129/:137`), late user kept | **`404 was not equal to 405 (ProductEventRollupServiceSpec.scala:131)`**, exit 1 |

  - In A, line 112 is the rollup SUM assertion. The red is real and comes from the wall clock.
  - In D, line 131 is the SUM assertion in the mutated file, which has 2 extra lines. That is the exact string design.md Decision 4(d) requires, so the permanent late-user guard can be made to fail by mutation on every run, whatever the date.
- **AC1, expected counts scoped to the fixture's own users:**
  - `withHistoricalUsers` (`:74-77`) captures the roster by exact id right after the pinning UPDATE. It asserts the roster contains userA, userB and the decoy, and passes it into the body.
  - `fixtureSignups` (`:102-107`) counts signups for roster ids plus `@backfill.invalid` users only.
  - Expectations at `:116/:129/:137` are `400 + roster.size`. No whole-table `users` count remains (`otherUsers` was removed).
  - Variant B shows that wall-clock `now()` users neither enter nor skew the counts.
- **AC2, no assertion depends on the wall-clock date:** every `created_at` in the fixture is a literal. The late user is pinned to the literal 2026-10-05 (`:80`). Variants head, B and B-tz are green on 2026-10-08 under an extreme-offset timezone.
  - The one accepted carve-out is a wall clock set back before 2026-10-03 combined with an unpinned row in the body. design.md Risks discloses it and skeptic-design-2 accepted it. It is not reachable, because today is past the anchor.
- **AC3, red first plus a standing guard:**
  - I reproduced the red (A) and the post-fix green (B) myself, and they match the executor's saved `red-wallclock.log` and `mutation-revert-scope.log` strings.
  - The permanent guard is `LateId`/`LateDay` (`:98-99`, `:80`), the by-id checks at `:117/:138`, and `eventCount(LateDay) shouldBe None` at `:130`. It is cleaned up by exact id in the `finally` (`:94`).
- **AC4, no loosened tolerance:** every count assertion is still an exact `shouldBe`. The diff adds no `>=` or range assertions. The existing `>= 400` at `:135` is unchanged from base.
- **Bug-fix discipline:** the root cause is probe-confirmed (variant A). The regression guard fails on the original defect shape (variant D).
- **SQL splice safety:** the `#$ids` splice at `:103-106` only takes values that went through `UUID.fromString` and were read from `users.id`, so it cannot inject.
- **Other gates:**
  - `node scripts/check-scala-quality.mjs`: "clean", exit 0. It reported soft size warnings only, none of them new.
  - I did not re-run full `testFull`. The evaluator pasted counts for it at this HEAD (6124/6124, 0 failed), and a test-only change to one spec cannot affect other suites; I ran the changed spec myself.
- **Gate-defect check (CON-160):** no load-bearing claim here rests on mtime ordering. All the evidence is pass/fail output from tests I ran myself.

### Verdict: CONFIRM

### Non-blocking notes
- The red/green/mutation transcripts in the change dir (`*.log`) are matched by `.gitignore:27` (`*.log`). They exist on disk but are not committed, so they disappear with the worktree unless they are persisted. The orchestrator may want to `persist-evidence.sh` them before Phase 4 if AC3's "transcript kept in the change directory" needs to outlive the worktree.
- `evaluation-2.md` is untracked in the worktree.
- The evaluator's optional suggestions still apply: bind the roster as a `uuid[]` instead of the `#$` splice, and factor out the duplicated late-user count at `:117/:138`.
