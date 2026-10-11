## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `863b888ee3728e92ddffa40793f40578e33d4772`. Live base from `resolve-review-base.sh`: `c587643384d9ccb3b117dcbb5b9d4c2ca082fc70` (exit 0). Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**AC1: scheduled firing is no longer delayed by the retention pass, and the bound is stated and proven on S4.**
- `PipelineSchedulerService.tick` (lines 120-129) starts `Future.delegate(purgeIfDue(now)).recover{log; None}` and discards it. The tick result zips only candidates, cleanup, auto-run and telemetry. The retention duration is out of the tick.
- I read the raw logs (`evidence/loop-*.log`) and checked them against every number in measurements.md section 1:
  - Main, first tick: 65574/60248/63136 ms. Each equals its own `@@PASS` duration, so the premise (the tick awaited the pass) is self-evident from the log content.
  - Main, AC fire delay: 90744/85488/88346 ms.
  - Branch, first tick: 44/37/37 ms. Branch fire delay: 25202-25221 ms in all three reps. Branch worst over all fires: 25.2 s. Branch ticks during a pass: 183-4778 ms.
  - Idle baselines: 35-169 ms (main) and 38-162 ms (branch).
  - Run durations in section 3 match `@@RUNDUR`.
- The stated bound is "tick interval + the tick's own work (incl. contention)". It holds (25.2 s ≤ 34.8 s). It is honestly worded: contention is named and measured, not hidden.
- Measurement safety:
  - Both the driver and the seed have refusal guards (`RetentionTickMeasure.scala:56`; seed lines 22-23), each with a refusal record.
  - Teardown log shows 0 remaining. I checked `docker ps -a` and `docker volume ls`: no `hel1477` objects remain.

**Concurrency of the in-flight guard (C7, design D2), read from `OutputHistoryRetentionService.scala`:**
- The CAS on `inFlight` comes first. On busy it returns `None` before `claim`, so `nextDue` is never read or written.
- When the pass is not due, the guard is released before returning. A synchronous throw in claim/setup releases it and rethrows.
- A started pass releases via `runPass(...).andThen{ inFlight.set(false) }`. `runPass`'s final `map` contains the `nextDue` CAS rewrite, so the release strictly follows the rewrite for both the history and payload parts. The returned future is the `andThen` future, so a caller that has seen completion has also seen the release.
- A repository throw is wrapped by `Future.delegate`, and the guard is still released.
- Advisory-lock and continuation semantics are untouched:
  - `thinPass` and `pg_try_advisory_xact_lock` are unchanged.
  - The precedence logic (failed → interval, busy → lockRetry, more → `now`) moved verbatim into `runPass`.
- MoreWork sets `nextDue` to the pass start, so the first tick after the pass ends continues it. This matches the spec delta and the CLAUDE.md wording.
- The live logs show the guard working on real data. In the branch logs, ticks 2-3 got `None` (0-1 ms) while pass 1 ran; tick 4 then started pass 2 (the continuation).
- No retention default changed: `OutputHistoryRetentionConfig` and `ThinBatchLimits` are not in the diff. No env var was added.

**Tests: red-first and mutation records.**
- `red-3.1-3.2.log`: 5 failed, 1 succeeded. The pass is the sync-throw case, labelled in the spec as a GUARD. Failure modes are TimeoutExceptions at the busy-call await and the tick await, which is what the unfixed code would produce.
- Mutation logs each recompile main classes and fail the intended tests:
  - 3.1a: the not-due exit leaks the guard.
  - 3.4: the row limit is ignored. The exact composition assertion fails at `OutputHistoryBatchedThinSpec.scala:168`.
  - The `andThen` release is dropped: 5/5 fail.
  - The scheduler recover is removed: 2 fail.
- No `Thread.sleep`/`eventually` in the new or migrated specs. The in-flight spec uses `VerifiedEmbeddedPostgres.start`.
- I re-ran the targeted specs myself at HEAD, niced, with MemAvailable 53.7 GB: InFlight, DetachedRetention, MaintenanceHooks, BatchedThin and RetentionLockGuard. Result: exit 0, `[hel1468-guard] failed=0 aborted=0 unreadable=0`, 19/19. No sbt JVM was left running.
- I relied on the evaluator's fresh testFull at this HEAD (`backend/target/hel1477-eval/testFull-3.log`, written 06:50, after the 06:40 merge). I read it: `[hel1468-guard] failed=0`, 6853 succeeded / 0 failed, and all four HEL-1477 specs ran.

**AC2: thinAndPurge.** `grep -rn thinAndPurge backend/src/main/scala` is empty. `RetentionDrain` (test support) is built only on the public `thinPass`, and 35 test references use it. V120 has no diff; only its historical comment mentions the name, which is correct because editing it would change the checksum.

**AC3 (polish).**
- The row-limit test now asserts exact batch composition at two limits plus the survivor count.
- The archived HEL-1435 measurements.md now has the `SET LOCAL work_mem` sentence and drops "first clone was the colder run".

**CLAUDE.md row.** It is accurate:
- the tick does not wait;
- at most one pass is in flight;
- a pass now bounds pass length and contention, not tick stall;
- it uses a privileged-pool connection (`withSystemContext`);
- continuation happens at "the first scheduler tick at or after the pass ends".

No other doc or comment still claims a tick stall.

**Committed scripts and evidence.**
- `hel1477-container.sh`, `rep.sh`, `m.sh`, `*-runs*.sh` and `RetentionTickMeasure.scala` contain no absolute home paths; they resolve repo-relative.
- No secrets: there is a trust-auth local container and an empty password to a 127.0.0.1 scratch DB.
- The sbt logs do contain `/home/matt/...` lines printed by sbt itself. See the notes below.

**UI:** no frontend changes, so not applicable.

### Verdict: CONFIRM

### Non-blocking notes
- `evidence/green-targeted.log` is named "green" but records 2 FAILED MaintenanceHooksSpec tests (line 57, `false was not equal to true`). It looks like an intermediate run from before the logger-class fix. The real green is `green-hooks.log` plus testFull. Rename it (for example to `intermediate-targeted-red.log`) or drop it, so it cannot be cited as a pass.
- measurements.md measures fire delay as "tick start − next_run_at". Design D5 specified "run row `created_at` − next_run_at", and the deviation is not labelled in section 4. The firing tick took up to 2.6 s on the branch's tick 2, so the true created_at delay is up to about 27.8 s. That is still within the 34.8 s bound.
- Small wording errors in measurements.md:
  - main passes after the first are 14.2-23.7 s, not "14-23 s";
  - "branch passes outlive 4 ticks" is loose: the first pass spans ticks 1-3, and the longer loop is about matching pass counts;
  - "about 5-20% longer" (evaluator's note).
- The contention term in the bound was measured only on `prod-io-base`, not on cold strict-IO. Section 4 labels this, which is honest. Under strict IO the per-tick contention would likely be larger.
- The committed sbt logs carry absolute `/home/matt/...` build paths. This matches extensive precedent (about 1240 archived files) and `check:no-credential-leak` passed. Strip them if the repo ever adopts a no-home-path rule for evidence.
- No gate defect: no claim here rests on mtime ordering. The main-vs-branch provenance is self-authenticating from the log content (on main the tick equals the pass; on the branch the tick is far shorter than the pass).
