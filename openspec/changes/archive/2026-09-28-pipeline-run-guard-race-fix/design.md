## Context

`PipelineRunGuardIntegrationSpec`'s concurrency-cap test (lines 254-280) submits 8
concurrent REAL runs against `maxConcurrent = 3` through a `GatedExecutionBackend` (added
during HEL-505 review) that blocks every admitted run's `execute()` on a shared
`Promise[Unit]`, so no admitted run can reach a terminal status — and free its slot — until
the test calls `gate.success(())`. The test's `awaitQueuedCount` helper (lines 160-171)
polls until exactly `maxConcurrent` rows are `status = "queued"`, then releases the gate and
asserts `results.count(_.isRight) shouldBe maxConcurrent`. It failed 4-of-8 in CI
(2026-09-26) with the gate already in place.

The production guard (`PipelineRunRepository.insertRunIfUnderConcurrencyCap`, lines
129-159) composes `pg_advisory_xact_lock(hashtext("pipeline-run-concurrency:" + userId))`,
an ownership check, a live non-terminal-count read, and the conditional insert into ONE
`DBIO` chain under a single `ctx.withUserContext` transaction — on inspection this appears
to correctly serialize same-owner submissions and make count+insert atomic. But
"appears to, on inspection" is exactly the confidence level `.concertino/laws/
systematic-debugging` prohibits acting on — this design commits to probing before fixing.

See proposal.md for the two live hypotheses; not restated here.

## Goals / Non-Goals

**Goals:**
- Probe-confirm, with instrumentation and a forced small-pool repeated-loop repro, whether
  the CI failure is a test-coordination defect (H1), a guard-locking defect (H2), or both.
- Ship a fix for whichever is confirmed, backed by a red-before/green-after deterministic
  test (not a timing-dependent retry of the flaky repro).
- Leave the guard's existing concurrency-cap CONTRACT unchanged ("at most N non-terminal
  runs at any instant") — only correctness/enforcement of that contract, or the test's
  ability to observe it, is in scope.

**Non-Goals:**
- Re-opening HEL-505's rate-limit, dry-run-exclusion, or trigger-source design decisions.
- Adding retries, sleeps, or a loosened assertion anywhere (ticket's explicit "never fix by").
- A cross-owner concurrency change — the lock is intentionally per-owner (design.md
  Decision 3 of HEL-505); out of scope unless the probe implicates it directly.

## Decisions

**Decision 1 — Probe before fix (systematic-debugging), cheapest evidence first.** Step 0,
before writing any new instrumentation: check
`PipelineRunRepositorySpec.scala:639-660` ("concurrent submissions for the same owner never
exceed the concurrency cap," HEL-505 tasks.md 8.4/C2) — it already calls
`insertRunIfUnderConcurrencyCap` 12 times concurrently via real `Future.sequence`, never
completes a run, and asserts exactly `maxConcurrent` `Inserted` / rest `CapExceeded`. This
already exercises the guard's lock+count+insert atomicity under MORE real concurrent
contention (12 writers vs. the failing test's 8) with zero gate/polling machinery to blame
for a false result either way. Its `git log` shows a single commit (HEL-505, `29a47220`/
`2cc73b4e`) with no subsequent fix, and no ticket/doc anywhere records it ever failing — a
clean history here is itself evidence against H2 (a genuine guard-atomicity defect would
plausibly also surface under 12-way contention with no gate confounder); a past failure
found here would already implicate H2 directly and should short-circuit the rest of this
step. Only after recording this check's result does the executor add new instrumentation
(temporarily, test-only — see Decision 3's H1 branch — never committed as-is): three
timestamps per submission in the FAILING test — advisory-lock acquire, admission decision
(Inserted/CapExceeded/NotOwned) with the observed non-terminal count, and (for admitted
runs) terminal-write time relative to `gate.success(())`. It then runs that test in a tight
loop under a forced-small connection/thread pool to reproduce the over-admission
deterministically enough to read the interleaving off the log — **hardware cap: 3-4
workers, `nice -n 19`, never sized to the 6c/12t host's core count** (per the ticket's and
CLAUDE.md's explicit instruction). This mirrors HEL-505 review's own successful repro
methodology ("forced the pool down to `Some(3)`").

**Decision 2 — Branch on the confirmed root cause, not on inspection alone.** Static
reading suggests H1 (the polling helper can return while a straggler submission is still
mid-decision, and that straggler can then race the gate-release-triggered completions of
the already-admitted 3 and be legitimately admitted into a freed slot) is more likely than
H2, since the guard's lock+count+insert is already one transaction. But the probe is what
decides, not this reading — if the log shows an admission decision reading a stale/lower
count than reality while holding the lock, that reopens H2 regardless of what the code
looks like from the outside (Slick/HikariCP connection-affinity bugs, an unexpected
transaction-isolation surprise, or a retry-on-serialization-failure path re-running the read
outside the lock are all things a structural read alone cannot rule out).

**Decision 3 — Fix shape per branch:**
- **H1 confirmed:** replace `awaitQueuedCount`'s "poll for count == N" coordination with a
  mechanism that proves every one of the 8 submissions has REACHED a terminal decision
  (admitted-and-queued, or rejected) before the gate is released. This is captured entirely
  inside `PipelineRunGuardIntegrationSpec.scala`'s own test file — zero production
  `PipelineRunService`/`PipelineRunRepository` changes needed: ground truth
  (`PipelineRunService.executeRun`, main/.../PipelineRunService.scala:1003-1029) shows the
  concurrency-cap decision always fully resolves strictly before `backend.execute()` is
  invoked for an admitted run, so a settlement signal can be fired from inside the test's own
  `GatedExecutionBackend.execute()` override (fires "admitted" on entry, before blocking on
  the gate) paired with each submission's own `Future` — a rejected submission's `submit()`
  call resolves quickly on its own, with no gate involved. Await all 8 settlement signals
  (not a DB poll) before calling `gate.success(())`.
  **Does the existing `PipelineRunRepositorySpec` test (Decision 1's Step 0) already satisfy
  the ticket's "prove the guard separately with a deterministic interleaving test"
  requirement? Yes, conditionally on Decision 1's Step 0 finding no red flag in its history**
  — it already proves the lock+count+insert composition is atomic under real concurrent
  contention, independent of any gate/polling mechanism, and its assertion holds regardless
  of actual thread interleaving (that is precisely what the advisory lock is for — the test
  doesn't need to CONTROL the interleaving because the guard's own correctness claim is
  "correct under ANY interleaving"). So **task 2.2 is rescoped from "add" to "verify + cite"**:
  confirm this existing test still passes (isolated re-run, not just as part of the full
  suite), cite it explicitly in the PR/commit as the guard-atomicity proof, and add a NEW test
  only if Decision 1's Step 0 or the probe log surfaces a gap this one doesn't cover (e.g., if
  it turns out not to reliably force real concurrent DB contention in practice — verify this
  by confirming the log shows genuinely overlapping lock-acquire attempts, not serialized
  ones, before relying on it).
- **H2 confirmed:** fix the transaction/lock scope in `insertRunIfUnderConcurrencyCap` so
  the count read and the insert are provably serialized against every concurrent submitter
  (e.g. an isolation level or connection-pool interaction that lets the count read outside
  the lock's effective serialization). Add a deterministic interleaving test that is RED
  against the current guard code and GREEN after the fix.
- **Both confirmed:** fix both, independently provable.

**Decision 4 — Mutation requirement (applies whether or not a NEW test is added).** The
guard-atomicity test being relied upon as proof — whether that is a newly-added interleaving
test (H2, or H1 if Decision 3's gap-check found one needed) OR the pre-existing
`PipelineRunRepositorySpec.scala:639-660` test cited under Decision 3's H1 "verify + cite"
path — must be demonstrated failable by mutation (per the ticket's and CONTRIBUTING's
guard-test standard) before it is relied upon as sufficient proof, not only shown to
currently pass. A test that has never failed historically is a true-positive check; a
mutation-kill demonstration is what proves it is also a true-negative check — the
"appears to, on inspection" confidence level this design already rejects elsewhere applies
here too. Concretely: temporarily widen `maxConcurrent` by one, or drop the lock acquisition,
against whichever test is being relied upon, and show it goes red — then revert the mutation
before commit. This applies EVEN when task 2.2 concludes the cited pre-existing test is
sufficient and no new test is written.

## Risks / Trade-offs

- [Risk] The forced-small-pool repro may not reproduce deterministically even locally →
  Mitigation: loop it (bounded iterations, 3-4 workers/`nice -n 19`) and treat a
  non-reproducing but still-plausible H1 read of the code as insufficient; escalate to the
  driver per the budget-exhaustion rule rather than shipping a fix without a red repro.
- [Risk] Instrumentation changes timing enough to mask the race it's measuring (Heisenbug)
  → Mitigation: prefer lightweight, already-in-process logging (`System.nanoTime()` +
  `println`/`scribe`, no extra DB round-trips) over anything that adds its own synchronization.
- [Risk] A guard-side fix could tighten the lock scope enough to hurt legitimate throughput
  → Mitigation: keep the lock scope to exactly the count+insert decision (as today), not the
  whole execution; the existing per-owner keying already limits blast radius to one user's
  own submissions.

## Planner Notes

- Chose `skip_specs: true` (proposal.md) because both fix shapes correct behavior against
  the guard's EXISTING, unchanged concurrency-cap contract — no spec-level requirement
  changes either way.
- No `.husky/**` or gate-chain script touched by this ticket — the CON-132 gate-chain
  checklist is not applicable here.
- Revision (design-gate round 1, REFUTE): reconciled the plan with the pre-existing
  `PipelineRunRepositorySpec` concurrent-race test (Decision 1 Step 0, Decision 3's H1
  branch) — it already proves guard atomicity under real contention with no gate/polling
  confounder, so the H1 fix path is now "verify + cite," not "add a duplicate test," unless
  the probe itself surfaces a gap. Also committed the H1 coordination fix to a test-only
  route (no production code changes) per the same round's non-blocking note.
- Revision (design-gate round 2, REFUTE): round 1's "verify + cite" rescoping silently
  dropped the mutation-kill requirement for the H1 path (Decision 4 / task 2.4 were worded
  only around a NEWLY ADDED test). Fixed: Decision 4 and task 2.4 now require a mutation-kill
  demonstration against whichever test is relied upon as proof, including the pre-existing
  cited test, whenever no new test is written.
