## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 2c1884ac5b2cc2578320ace4a21e37b32df5c603. The planning artifacts are untracked in
`openspec/changes/retention-lock-skip-retry/`. I did not run sbt: this is the design gate and there is no code yet.
Every claim below was checked against the live source.

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (D5.1/D5.2 red proofs): addressed, and correct.**
  - D5.1 now says that stash-on-main goes red at `t0`. That is correct: on main, `OutputHistoryRetentionService.scala:44-47`
    wraps the repo's `0` as `Some(0)`.
  - The retry red comes from a mutation that keeps `LockBusy` but drops the shortening CAS. Under that mutation,
    `nextDue` stays at `t0 + interval`, so `purgeIfDue(t0 + retry)` returns `None` and the eligible points survive. That
    is a real red at the assertion that matters, provided `lockRetry < purgeInterval` (true for the defaults, 120 s vs
    60 min).
  - The success-restores-interval assertions (`t0+retry+interval-1s` / `t0+retry+interval`) are present.
  - D5.2's shorten-on-failure mutation would make `purgeIfDue(t0+retry)` run, so that red is also real. It falls back to
    a "guard" label otherwise.
  - D1 now spells out the reference-equality hazard of `AtomicReference.compareAndSet`.
- **CR2 (deterministic reverse direction, D5.4): addressed. I checked the physics.**
  - **Lock order is real.** `OutputHistoryRepository.scala:153-154` takes `pg_try_advisory_xact_lock` and then runs
    `purgeByAge.flatMap(a => thin.map(_ + a))`, all inside one `.transactionally` (`:159`). So the age DELETEs (`:110-122`)
    run and keep their row locks before the thin DELETE (`:133-149`) starts.
  - **The thin DELETE blocks on X only if X is a thin target.** The subquery is a plain read. `DELETE ... WHERE id IN (...)`
    tries to lock only the rows it qualifies. A `FOR UPDATE` held on a thin-eligible X therefore pauses the real
    retention in the thin DELETE, after the age deletes. Two conditions follow: X must not be age-eligible (otherwise
    the age DELETE blocks first), and X must not be one of the P_old-linked points. The age DELETE does not block on a
    non-qualifying locked row, because row locks do not block the predicate read.
  - **The trim victim hits the age-locked rows.** The `payload_id` FK is `ON DELETE SET NULL` (`V116__node_payload_history.sql:62`).
    The trim (`NodePayloadHistoryRepository.scala:101-108`, `OFFSET keep LIMIT 1`) deletes P_old if the node has
    exactly `keep` payloads before the write and P_old is the oldest. `NodePayloadTrimPurgeLockOrderSpec` seeds exactly
    this with `keep = 1` (`:47-48`). The RI cascade's `UPDATE ... SET payload_id = NULL` then has to wait for the
    retention xact that deleted those rows, because they are deleted but not committed.
  - **The red proof is genuine.** With the `pg_try_advisory_xact_lock_shared` guard (`:117-122`) removed, the run's
    cascade waits on retention, and retention waits on X, which a third connection holds. So the run cannot commit
    inside the bound. This is the same mechanism that HEL-1333's regression (`NodePayloadTrimPurgeLockOrderSpec:228-265`)
    was shown red on, now driven by the real age DELETE instead of a hand-issued single-row delete.
  - Note: there is no cycle here, so the red shows up as the bound failing, not as a 40P01. The design's "(the
    `writeAction` bound fails, or 40P01)" is accurate.
  - **The green path is achievable.** The run's `ownerLimit` read, its payload INSERT, and its history `insertAction`
    touch no row that retention holds. Its new rows are invisible to retention's statement snapshots.
- **CR3 (MODIFIED delta for output-history-retention): addressed.** The MODIFIED header matches
  `openspec/specs/output-history-retention/spec.md:9` exactly. The full requirement text is restated with the
  lock-retry exception, and all three original scenarios are kept. "Second tick" is reworded to "after a purge that
  ran". The ADDED config requirement (cap at interval) is compatible with the existing "Env-driven retention
  configuration" requirement.

**Other claims re-verified**

- `claim` CASes `lastAttempt` before the repo call (`OutputHistoryRetentionService.scala:61-65`).
- `purgePayloads` swallows its error into `Unit` (`:56-59`). D2/task 2.2 now require a three-way result.
- The constructor and `fromEnv(env = sys.env)` signatures are unchanged by the plan. `NodePayloadWiringSpec` stays
  source-compatible.
- No test constructs `OutputHistoryRetentionConfig(...)` positionally (grep of `src/test`). Adding the last field with a
  default is safe.
- Callers needing updates (grep of `thinAndPurge`/`.purge(`):
  - `OutputHistoryRepositorySpec` (12 sites)
  - `NodePayloadTrimPurgeLockOrderSpec:259`
  - `NodePayloadHistoryRlsSpec:178`
  - `NodePayloadHistoryRetentionSpec:27`
  - `PipelineSchedulerServiceSpec:292` (override)

  Every one is in task 3.1. `ProductEventRepositorySpec`'s `.purge` is a different repo and is not affected.
- The privileged Hikari pool in the two-role spec template has 5 connections (`NodePayloadTrimPurgeLockOrderSpec:82-84`).
  So D5.3's latch-held run transaction does not starve the retention call of a connection.
- No migration is planned. No plan item touches `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts` or
  `.gitignore`.

**New finding: a second capability spec contradicts the planned code**

- `openspec/specs/output-snapshot-history/spec.md:69` ("History repository primitives") contains this scenario at
  `:83-85`: "A pass that finds another in progress deletes nothing". Its THEN says "it returns 0 and no point is
  deleted".
- Under D2, `thinAndPurge` returns `LockBusy` in exactly this case, not `0`.
- The proposal lists only `output-history-retention` under Modified Capabilities, and the change has no
  `specs/output-snapshot-history/` delta.
- After archive, the capability spec would state a return value the code no longer produces. This is the same class of
  defect as round-1 CR3, in a sibling capability.
- Task 3.1 has a matching problem. It says to update existing callers "mechanically to `Purged(n)`" and that they
  "pass unchanged in meaning". But the HEL-1272 lock-held repo test (`OutputHistoryRepositorySpec.scala:281-295`,
  asserting `shouldBe 0` at `:289`) must become `LockBusy`. That is a change of meaning, and it is the repo-level
  proof of D2's whole premise. Read literally, task 3.1 would turn it into `Purged(0)`, which would fail.

### Verdict: REFUTE

D1–D5 are now sound. D5.4's lock order, victim targeting and red proof all hold against the real code. One contract
contradiction remains. It is cheap to fix now and would otherwise ship into the archived specs.

### Change Requests

1. **Add a spec delta for `output-snapshot-history`.**
   - Create `specs/output-snapshot-history/spec.md` in the change, containing a `## MODIFIED Requirements` entry for
     "History repository primitives".
   - Restate the requirement in full, with all of its scenarios.
   - Change the scenario "A pass that finds another in progress deletes nothing" so the THEN says the pass reports a
     lock-held skip that is distinct from a zero-delete pass (not "returns 0"). Keep "no point is deleted, and a later
     pass after the lock is released thins them".
   - Consider rewording "finds another in progress". Since HEL-1333, the holder can also be a run's write-time trim
     holding the key shared, not only another thinning pass. "Finds the retention lock held" is accurate.
   - Add `output-snapshot-history` to proposal.md's Modified Capabilities.
   - Also check `openspec/specs/node-payload-history/spec.md`. I found no return-value statement about `purge` there,
     but confirm while you are at it.
2. **Fix task 3.1's wording.** Every existing caller becomes `Purged(n)` with the same `n`, EXCEPT the HEL-1272
   lock-held test (`OutputHistoryRepositorySpec.scala:281-295`), which must assert `LockBusy` at `:289`. Name that test
   explicitly, and record its red on main: the stash run yields `0`, not `LockBusy`. Then the repo-level evidence for D2
   is recorded, not implied.

### Non-blocking notes

- **D5.4 seeding:** state the preconditions the test depends on, so a future fixture tweak cannot silently make it
  vacuous:
  - X is thin-eligible but NOT age-eligible, and NOT linked to P_old.
  - The node has exactly `keep` payloads before the write (e.g. `keep = 1` as in `NodePayloadTrimPurgeLockOrderSpec:47`),
    so P_old is the trim victim.
  - The P_old-linked points are age-eligible under the caps passed to `thinAndPurge`.

  Also assert on the green path that the payload count is `keep + 1` (trim skipped), as the HEL-1333 regression does.
- **D5.4 topology:** run it as `helio_privileged` on the two-role setup, like `NodePayloadTrimPurgeLockOrderSpec`. The
  revised D5.4 text no longer says so. It is not strictly needed for this property, but it keeps parity with the
  driver constraint and with D5.3.
- **D5.4 red label:** the expected red is "the `writeAction` bound fails" (a wait, not a cycle). Record it that way
  rather than hoping for a 40P01.
