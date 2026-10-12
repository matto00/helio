## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `bbe1d098dce99ef1d7e2de0605ce0af41d6e3e3f`. The base `54f2943cd20b0ac26f3f1581bb1fcf15bfb8a8fc` was resolved live with `resolve-review-base.sh` (exit 0). `origin/main` is 3 commits ahead of the base. None of those commits touch `services/pipelines`, `persistence/pipelines` or the migrations, and V125 is still free on `origin/main` (the latest there is V124).

### What I verified (with evidence)

**Spawn guard**
- `assert-cwd.sh` returned `READY`.

**Owner rulings**
- `events.jsonl` `escalation.answered` (`answer_source: human`, id `HEL-1504-1791759145023-49a06d`) records:
  - `keep-pending-fire-after-run`
  - `retry-after-capped-N-then-drop-with-warn`
  - `no-writer-signal-here`
- The implementation matches all three. No writer-facing code changed.

**AC1: deterministic red-first repro**
- `DatasetWriteAutoRunDroppedFireSpec` drives `tick()` on an injected `FakeClock` that is used by both the scheduler and the guard (`guardClock`). It uses VerifiedEmbeddedPostgres with Flyway, has no sleeps, and asserts on rows only.
- I re-derived red-on-main myself. I restored the base's `PipelineAutoRunDebounceFirer.scala` into a scratch export of HEAD and ran HEAD's spec unchanged:
  - (a), (b) and (c) failed at `debounceRowExists(pid) shouldBe true` (lines 197, 236, 271), the dropped-row assertion.
  - (d) and `AutoRunGuardNoRetryStormSpec` also went red.
  - Transcript: `.concertino/runs/HEL-1504/evidence/skeptic-mutation-m0.txt`.
- This agrees with the executor's `red-repro.txt` and the evaluator's `eval-red-on-main.txt`. Both show 3/3 failing at the same assertion.

**AC2: exactly one eventual run, HEL-505 not bypassed, no unbounded loop.** Traced in the code:
- **Active run (D1).** `processAutoRunClaim` → `unclaim`, a compare-on-token `UPDATE ... SET claimed_at = NULL` that does not delete the row. `fire_at` and `guard_retry_count` are untouched. The row is re-polled every tick, and the first tick after completion falls through to `submit`. Test (a) asserts run count 1 → 1 → 2, with the row gone afterwards and no further run.
- **Guard rejection (D2).** `TooManyRequests` → `rearmAfterGuardRejection` with `fireAt = now + max(1, retryAfter)`. This is one transaction (`withSystemContext` = `.transactionally`):
  - a guarded UPDATE (`guard_retry_count < max`);
  - else a token-matched DELETE;
  - else `Superseded`.
  This is bounded. Each pending write gets at most N re-arms, spaced at least Retry-After apart and at most once per tick (`claimDue` claims each row once). A fresh write resets the count, so the bound scales with the write rate.
- **Cap pre-flight (D2a).** It is read-only. It uses the same Slick query as the authoritative cap, extracted into the shared private `ownerInFlightRealRunsQuery`, not a copy. It only ever withholds and never admits; `submit` remains the only admission. Test (c) asserts `rateCount(owner) == 0` across the withheld attempt.
- **HEL-505 not bypassed.** Every submission still goes through `PipelineRunService.submit`. The only producers of `TooManyRequests` are `PipelineRunExecutor.scala:136` (rate) and `:167` (cap, owner-keyed). The "owner budget" named in the docs is that HEL-1492 owner-keyed cap, so the CLAUDE.md wording is accurate.

**Races I checked**
- **Upsert during the rearm UPDATE.** Postgres EvalPlanQual re-checks `claimed_at = token` after the upsert commits and matches nothing. The DELETE then also misses, giving `Superseded`, and the fresh write survives with count 0.
- **Upsert between the guarded UPDATE miss and the DELETE.** The statement sees the committed `claimed_at = NULL` under READ COMMITTED, so this is also `Superseded`.
- **Stale reclaim (300 s) vs a late `unclaim`/`rearm` from the first claimant.** The late call misses on the token. This is no worse than the pre-existing `releaseClaim`, and design.md Risks discloses it.
- **D1 polling every tick.** This keeps any single claim from being held for 300 s.
- **Orphaned `completed_at IS NULL` runs.** These keep a D1 row polling indefinitely: one cheap claim plus one exists-check per tick, no runs and only DEBUG logging. The same blocker already applies to scheduled runs, and design.md Non-Goals discloses it. Not a storm.

**My own mutations (scratch export under the run dir, now removed; transcripts kept)**

| Mutation | Change | Result | Transcript |
|---|---|---|---|
| M0 | base firer | 5/5 red | `skeptic-mutation-m0.txt` |
| M1 | dropped `AND guard_retry_count < $maxRetries` | (d) red at :310 and `AutoRunGuardNoRetryStormSpec` red at :208 (row never removed, an unbounded retry) | `skeptic-mutation-m1.txt` |
| M2 | pre-flight `>=` changed to `>` | (c) red at :273 (`1 was not equal to 0`, a rate slot burned) | `skeptic-mutation-m2.txt` |
| M3 | dropped the `guard_retry_count = 0` reset on upsert (same run as M2) | `PipelineAutoRunDebounceRepositorySpec` "a fresh write resets the retry count" red at :349 | `skeptic-mutation-m2.txt` |

The tests are failable rather than evidence-shaped.

**Gates re-run at HEAD**
- `nice -n 19 sbt -batch -Dsbt.server.autostart=false -J-Xmx3g "testOnly ..."` ran these specs:
  - DatasetWriteAutoRunDroppedFireSpec
  - AutoRunGuardNoRetryStormSpec
  - DatasetWriteAutoRunEndToEndSpec
  - PipelineAutoRunDebounceRepositorySpec
  - PipelineSchedulerServiceSpec
- Result: 34 succeeded, 0 failed, and `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. Every suite is listed by name in the output. Transcript: `evidence/skeptic-targeted.txt`.
- I did not re-run testFull. Another lane's testFull was live, and the cycle-2 delta (`git diff 30eacce4f bbe1d098d`) is docs and openspec only. The evaluator's testFull at the worktree path shows 7179 passed, 0 failed and `[hel1468-guard] failed=0 aborted=0` (`eval-testfull.txt`), and it covers the code that ships.

**Public `guardConfig` val**
- Acceptable. It is a plain config case class with no secrets. The firer reads it off the same `PipelineRunService` instance it submits through, so the cap, the advisory Retry-After and the allowance cannot drift apart. The only other construction site is `ApiRoutes.scala:471`.

**Spec deltas**
- `dataset-write-auto-run`:
  - The MODIFIED requirement keeps every live scenario: the rate-limit scenario (reworded), the owner attribution scenario (verbatim) and the no-retry-storm scenario (reworded to bounded retry).
  - It adds the rate-window and cap-slot scenarios.
  - The ADDED active-run requirement matches D1.
- `pipeline-run-guard`: the delta matches the D2a pre-flight (stricter than the guard, never looser).

**CLAUDE.md row**
- Every clause matches the code: default 10; `<0` or non-numeric falls back (`toIntOption.filter(_ >= 0)`); 0 means drop on the first rejection (`Exhausted(0)`, which the repository spec covers); the 1 s floor; the reset on write; the pre-flight; active-run waits do not use a retry.

**Other checks**
- No inline FQNs in the added Scala: a grep of the non-import `+` lines found none.
- V125 is additive with a default.
- I read MISTAKES.md for the sbt hazards and used the documented `-batch -Dsbt.server.autostart=false` invocation from the worktree's own `backend/`. No sbt server was left running.

### Verdict: CONFIRM

### Non-blocking notes
- `DatasetWriteAutoRunDroppedFireSpec` (d)'s closing "fresh write resets to 0" assertion is vacuous. The row was already deleted, so the upsert takes the INSERT path, and mutation M3 did not turn it red. The repository spec catches M3, so coverage exists, but that assertion proves nothing. Consider re-arming once before the fresh write.
- The spec scenario "Several writes during one in-flight run still produce one follow-up run" has no dedicated test. It follows structurally from the one-row-per-pipeline upsert.
- The `Superseded` debug log says "superseded by a fresh write", but a stale-claim reclaim by another instance also produces `Superseded`. The wording is slightly narrow; this is cosmetic.
- The 1 s Retry-After floor has no direct test. It is defensive only, because `claimDue` already claims each row at most once per tick.
