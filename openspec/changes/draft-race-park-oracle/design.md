## Context

See proposal.md (Why). The harness under suspicion is `DraftRaceFixture.race(...)` (backend/src/test/scala/com/helio/testsupport/DraftRaceFixture.scala). Relevant facts read from the tree at 4429d46fd (claims for the executor to re-verify, not to trust):

- `RaceSaveHooks.at(point)` completes the `parked` promise as a side effect of *calling* `at(...)`, then returns `DBIO.from(release.future)`. Calling `at` and executing the returned DBIO are different moments in Slick.
- `PipelineDraftWrites.lockDefinition` builds `val panels/rules/outs = taken(site, lock)` where `taken = locks.choose(site, lock, unit).andThen(afterLock(site))`. `afterLock(site)` is therefore *called* when `lockDefinition` is invoked, before any of the lock statements execute. Only `afterLock(LockSite.SavePipeline)` is inside a `for` (lazy). `AfterCompare` is also lazy (`_ <- hooks.at(AfterCompare)` in DraftSaveTransaction).
- Both CI failures used `parkAfter = Some(LockSite.SaveRules)`. The attempt-2 control returned `PatchSetStale`; note this does NOT discriminate (a) from (b), because a `parkAfter=SaveRules` park is always before the compare (design-gate note 1) — root-cause.md must not cite it as evidence either way.
- The trace text "PARKED past its compare" is wrong for `parkAfter` sites; it is corrected as part of the fix.
- SaveFirst then waits at most 5000 ms for "writer completed OR writer observed waiting on the save" via `activeBackend("race-writer")` (latest non-idle backend with that application_name) and `pg_blocking_pids`.

## Goals / Non-Goals

**Goals:**
- Decide (a) real lock gap vs (b) harness race from database evidence (`pg_locks`, `pg_stat_activity`, `pg_blocking_pids`) captured at the parked point and at the writer's commit, not from reading code.
- Under (b): an oracle whose "parked" means "the save's transaction has executed up to the hook and holds the locks taken so far", and whose "blocked" observation does not depend on a wall-clock window a slow runner can exhaust.
- Every existing lock-removal control and mutation still turns the suites red; the corrected suites pass 50/50 under CI-like load.

**Non-Goals:**
- Changing the production lock protocol or the order O* under (b).
- New race coverage for writers not already in the specs.
- Fixing unrelated flakiness elsewhere in the backend suite.

## Decisions

**D1. Probe before fix, with a deterministic forcing probe plus a statistical repro.** A statistical repro under load (taskset to 2 cores, `nice -n 19`, `HEL924_TEST_GROUP_CONCURRENCY=2`, CI-sized heap `HELIO_TEST_JVM_XMX=4g`, repeated `testOnly` runs through the sbtfull flock) shows the failure occurs locally. A deterministic probe makes the cause unambiguous: delay the save's lock statements from outside (e.g. an extra session holding a row lock the save's first protocol lock must wait on, or the equivalent) and snapshot, at the instant `parked` completes, the save backend's `pg_stat_activity.state`/`wait_event_type` and its granted `pg_locks` rows on `alert_rules`/`outputs`/`pipelines`/`panels`; snapshot again when the writer completes. Under (b) the expected trace is: save backend `active` and waiting (or holding none of the `parkAfter` site's row locks) when "PARKED" is noted; the writer commits with no wait. Under (a) the save holds the site's locks (granted rows visible) and the writer still commits without waiting. Probe code lives in scratch or in a throwaway test, never in the final diff. *Alternative rejected:* inferring the cause from the code reading above alone — the iron law requires a probe-confirmed cause.

**D2. Fix the park signal in the fixture, not in production code.** `RaceSaveHooks` returns a DBIO whose side effects (completing `parked`) run when the DBIO *executes* (e.g. `DBIO.successful(()).flatMap { _ => parked.trySuccess(()); DBIO.from(release.future) }`). This makes the harness correct regardless of whether production composes hooks eagerly or lazily. *Alternative rejected:* changing `lockDefinition`'s `taken` to defer `afterLock` — it fixes only this call site, touches production code for a test seam, and the next eager composition would reintroduce the bug.

**D3. (Cross-check once D2 lands, not itself the fix.) Confirm "parked" from Postgres, not only from the promise.** After `parked` completes, the harness waits (condition-driven) until the save backend is `idle in transaction` (it has finished every statement up to the hook and is holding its transaction open) and records the save's granted lock rows in the trace. A save that is not idle-in-transaction when declared parked is a harness failure with a clear message, not a silent wrong verdict.

**D4. Replace fixed short windows that decide a verdict with condition waits bounded only as a hang guard.** The SaveFirst "writer completed OR writer waits on the save" wait (5000 ms) and the analogous WriterFirst/duel/race3 windows must not be able to expire on a slow runner and flip a protected case to `blockedObserved=false`. They become waits for a decisive observed state with a generous bound (a hang guard, e.g. 60 s) whose expiry is reported as "neither", not interpreted as a verdict. The writer-backend lookup must cover every backend with the writer's `application_name` (it runs on two pools), not only the most recently started non-idle one. Exact bounds are the executor's call, recorded with rationale. A "neither" outcome (hang guard expired with no decisive state) FAILS the test with a harness message. The 15 s wait for `parked` (race SaveFirst, race3) is included: if it expires the writer is NOT started and the test fails as a harness error.

**D5. Siblings.** `DraftSaveRaceSpec` and `DraftSaveSetRaceSpec` share `race`/`race3`/`duel`. D2–D4 live in the fixture so they cover them; the executor audits each path for any remaining construct-time signal or verdict-deciding timeout and records the audit.

**D6. Proof.** (i) The forcing probe from D1 turns the OLD fixture's protected case into the CI failure signature and the NEW fixture into a correct verdict (or a clear harness error), demonstrating the fix addresses the confirmed cause. (ii) 50/50 consecutive passing runs of `DraftSaveDeadlockSpec` under the D1 load profile; siblings repeated as well (count stated). (iii) Every existing lock-removal control/mutation in HEL-1629's evidence (SK1, SK3, SK5, M7 and every other recorded mutation that targets these specs) re-applied on the new tree turns its case red; logs kept.

**D7. Isolated database.** All runs use the isolated database `helio_hel1654` on the existing local Postgres (never the shared `helio`), created by the executor; no additional Postgres server is started. If one is started anyway for a probe, it is stopped with `pg_ctl` before the executor returns.

**D8. Escalation boundary.** If the D1 evidence shows (a), the executor stops before changing production lock code and returns `ESCALATION` with the traces and options; the plan is revised after the owner answers.

## Risks / Trade-offs

- [The forcing probe perturbs timing and could manufacture a failure the CI never had] → it is paired with an unperturbed statistical repro under load, and the CI signature (`blockedObserved=false`, PatchSetStale in the control) must match.
- [Longer hang guards slow a genuinely broken run] → only on failure; the green path is condition-driven and as fast as before.
- [Local load cannot reproduce CI at all] → the deterministic probe still establishes the cause; report the statistical repro rate honestly, including zero.
- [Mutation re-runs are expensive under the load gate] → run them through the sbtfull flock, sequentially, under `nice -n 19`.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` or pre-commit script is touched.
