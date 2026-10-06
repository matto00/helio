## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD 2c1884ac5b2cc2578320ace4a21e37b32df5c603. The planning artifacts are untracked in
`openspec/changes/retention-lock-skip-retry/`. I did not run sbt: this is the design gate and there is no code yet.

### What I verified (with evidence)

**Round-2 change requests**

- **CR1 (output-snapshot-history delta): addressed in substance.**
  - `specs/output-snapshot-history/spec.md` MODIFIES "History repository primitives". The header matches
    `openspec/specs/output-snapshot-history/spec.md:69` exactly.
  - All five original scenarios are restated with their original titles.
  - Only the body of "A pass that finds another in progress deletes nothing" changed. Its THEN now reads "reports a
    lock-held skip (not a zero-delete result)". Keeping the title follows the openspec no-rename rule.
  - The requirement text now names the shared run-trim holder.
  - proposal.md lists `output-snapshot-history` under Modified Capabilities.
  - `npx openspec validate retention-lock-skip-retry --strict` printed "Change 'retention-lock-skip-retry' is valid".
- **CR2 (task 3.1 wording): addressed.** Task 3.1 and design D2 both name the HEL-1272 lock-held test
  (`OutputHistoryRepositorySpec` ~:281-295) as the exception that asserts `LockBusy`, and require its stash-red (`0`) to
  be recorded.
- **Round-2 non-blocking notes:** all folded into D5.4.
  - The preconditions are stated: X is thin-eligible, not age-eligible, and not linked to P_old; `keep = 1`; the
    P_old-linked points are age-eligible.
  - The green-path payload count is `keep + 1`.
  - The test runs as `helio_privileged` on the two-role setup.
  - The red is recorded as "the bound fails", not as a 40P01.

**Independent re-checks against the live code**

- `OutputHistoryRetentionService.scala:41-65`. On main the repo's `0` is wrapped as `Some(0)`, `purgePayloads` swallows
  its error into `Unit`, and `claim` CASes before the call. All of this matches design Context.
  - The `nextDue` rewrite keeps the existing tests' meaning:
    - `OutputHistoryRetentionServiceSpec:102-120` (`Some(0)` at `now`, then `None` at +59m and `Some(1)` at +60m)
    - `:122-127` (8 concurrent callers, one defined)
- `NodePayloadHistoryRepository.scala:85-124`. The shared try-lock is taken unconditionally after the insert
  (`insert.andThen(guardedTrim)`). So D5.3's real `writeAction` holds the shared key for its whole transaction whether
  or not a trim victim exists, which means D5.3 is not vacuous.
- `NodePayloadHistoryRepository.scala:139-183`. `purge` returns `DBIO.successful(0)` on `false`, so D2's ADT change is
  required there too.
- The only production caller of `purgeIfDue` is `PipelineSchedulerService.scala:101` (`.map(_ => ())` + recover). The
  unchanged `Future[Option[Int]]` keeps it source-compatible.
- `NodePayloadWiringSpec` stays compile-compatible: same ctor, same `fromEnv`, same return type. There is no positional
  config construction in `src/test` (round 1 grep; there are no new test files since).
- No migration, ci.yml, playwright.config.ts or .gitignore edits are planned.
- I checked other capability specs for contradictions:
  - `grep -rn "purge interval|PURGE_INTERVAL|hourly|once per ... interval" openspec/specs` outside
    output-history-retention: no hits.
  - In `node-payload-history/spec.md:53-69,115-128`, "count cap deferred while retention runs" and "Retention
    housekeeping never fails or blocks a run" are consistent with the plan: a more frequent retry only removes excess
    sooner.
  - `OUTPUT_HISTORY_PURGE_INTERVAL` is documented only in CLAUDE.md, and task 2.3 covers it.
- **Red proofs re-traced.**
  - D5.1: under the mutation that drops the shortening CAS, `nextDue` stays at `t0 + 60m`, so `purgeIfDue(t0 + 120s)`
    returns `None` with the points intact. That is a real red at the right assertion.
  - D5.2: under the shorten-on-failure mutation, the stub runs at `t0 + retry`. Also a real red.
  - D5.4: with the guard removed, the trim's SET NULL cascade waits on rows that retention age-deleted but has not
    committed, while retention is parked on X. The bound then fails. This is a real red, with no cycle.

**New finding: the spec delta does not cover the partial-skip behaviour that the design and tasks implement.**

- Design D1/D2 and the proposal shorten the slot when *either* part of the pass reports `LockBusy`. Task 3.3 tests
  "payload `LockBusy` stub shortens", meaning history ran with `Purged(n)` and only the payload purge was lock-held.
- The two parts of one pass are separate transactions, each with its own try-lock (`thinAndPurge` commits and releases
  its xact lock before `purge` tries again). So a run can take the shared key in between, and the partial case is
  reachable in production.
- The delta never says that a partially skipped pass counts as "skipped":
  - The MODIFIED requirement reads "a pass skipped because the retention lock was held".
  - The ADDED requirement reads "When a retention pass is skipped".
- The restated scenario in `specs/output-history-retention/spec.md` reads:

  > "Second tick within the interval is a no-op — WHEN the scheduler ticks again less than the purge interval after a
  > purge that ran, with new thinnable points present THEN no history point is deleted"

- After a pass whose history part ran but whose payload part was lock-held, the planned code runs `thinAndPurge` again
  at `+lockRetry` and deletes those new thinnable points. The archived spec would then directly contradict behaviour
  that task 3.3 asserts.
- This is the same class of defect as round-1 CR3 and round-2 CR1: an archived capability spec stating a cadence the
  code does not follow. The D4 rule (failure in any part beats `LockBusy`) is also stated only in design.md, not in the
  spec.

### Verdict: REFUTE

D1–D5 are sound and the round-2 CRs are genuinely fixed. One remaining contract gap, a one-paragraph spec edit, would
otherwise ship a self-contradicting archived spec.

### Change Requests

1. **Make `specs/output-history-retention/spec.md` define what counts as a lock-held skip, including the partial case
   and the D4 precedence.**
   - In the ADDED requirement "Lock-held retention skip retries within a short window", state that the retry applies
     when *any* part of the pass is lock-held:
     - **(a)** if either the history thin/purge or the payload purge is skipped because the lock is held, and no part
       raised an error, the next pass is due after the retry window;
     - **(b)** if any part raised an error, the full purge interval applies even if another part was lock-held (D4).
   - Add a scenario for the partial case: history thinned, payload purge lock-held, so the next pass is due at the retry
     window.
   - Add a scenario for failure combined with lock-held: the full interval applies.
   - In the MODIFIED "Tiered time-bucket retention" requirement, change "a pass skipped because the retention lock was
     held" to "a pass any part of which was skipped because the retention lock was held".
   - Reword the "Second tick within the interval is a no-op" WHEN to "...after a purge none of whose parts was skipped
     for the lock...". Keep the scenario title, per the no-rename rule. Without this, that scenario contradicts task 3.3.
   - Re-run `openspec validate retention-lock-skip-retry --strict`.

### Non-blocking notes

- Existing doc comments will become stale, so update them in the code task:
  - `OutputHistoryRetentionService` class doc ("retries once per interval rather than every tick", which needs the
    lock-held exception)
  - `NodePayloadHistoryRepository.purge` doc ("a second instance skips and the next interval retries")
  - The `purgeIfDue` doc ("`None` when skipped (not due) or failed", which must now also cover a lock-held history
    part)
- D5.1 runs on `OutputHistoryRetentionServiceSpec`'s single-role `DbContext(db, db)`. A separate JDBC connection holding
  `pg_advisory_lock_shared` is role-independent, so this is fine. The two-role proof is D5.3/D5.4's job.
