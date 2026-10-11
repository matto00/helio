## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD bcb0e891923094c1a1e85ecc053f30a73ee6d70f. The planning artifacts are untracked in the change dir.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/retention-pass-wall-clock-budget/HEL-1477`.
- **Spec validity:** `openspec validate retention-pass-wall-clock-budget --strict` printed "Change 'retention-pass-wall-clock-budget' is valid".

#### CR 1 (V120 must not be edited): addressed

- Task 2.3's grep is now scoped to `backend/src/main/scala` and says "do NOT edit V120 (applied migration checksum)".
- D4 states that the V120 comment is not edited, and why (Flyway checksum validation).
- Ground truth: `grep -rn thinAndPurge backend/src/main` returns two hits:
  - `OutputHistoryRepository.scala:139`, which is the method being removed;
  - the V120 SQL comment, which falls outside the scoped grep.

  The scoped acceptance signal is therefore achievable without touching the migration.

#### CR 2 (guard/claim ordering): addressed

- D2 now fixes the order:
  1. CAS the guard. If it is busy, return `None` without touching `nextDue`.
  2. Claim. If the claim is not due, release the guard. Release on every non-starting exit, including a synchronous throw.
  3. Run the pass inside `Future.delegate`, and release only after the `nextDue` rewrite.
- I checked this against the current `purgeIfDue` (`OutputHistoryRetentionService.scala`):
  - The `nextDue` CAS rewrites run inside the final `flatMap`/`map`.
  - The history and payload parts both `recover`.
  - So "release on completion, after the rewrite" is implementable with a single completion hook on the returned future, and it cannot be skipped.
- Task 3.1 now advances the clock past `purgeInterval` before the second call. On unfixed code, that second call claims again and calls the repository a second time, so this is a valid red.
- Task 3.1a adds the not-due-then-due test that guards against a wedged flag.
- The spec ADDED requirement matches D2: a busy tick neither consumes nor moves `nextDue`, and the flag is released on success, failure or a synchronous error.

#### CR 3 (D5 metric b): addressed

- Metric (b) is now the fire delay of a schedule that becomes due *during* a pass. It runs under a loop driven exactly like `PipelineSchedulerActor` (next tick `tickInterval` after the previous tick completes), with delay = run row `created_at` − `next_run_at`, measured on both main and the branch.
- D5 explicitly says that (a) fires promptly on main because of the zip, so (b) is the AC metric. This matches the code: `PipelineSchedulerService.scala:120-127` builds `historyWork` eagerly, concurrently with `candidatesWork`.
- The stated bound is now absolute and checkable: fire delay ≤ tick interval + the tick's own non-retention work.
- Tasks 1.2 and 4.1 were updated to match. Task 4.1 also records lock-held skips, which covers the round-1 non-blocking note.

#### Independent re-check

- **Round-1 non-blocking notes:** all folded in.
  - The lock-skip risk is now in Risks.
  - The spec MODIFIED text defines "next scheduler tick" as the first tick at or after the pass ends.
  - Metric (e) covers run duration under contention.
  - D3 keeps `Future.delegate` + `recover`.
- **Scope and constraints:** no default changes and no new env var (C4). C1/C2/C5/C6 are restated. The ticket's polish items map to tasks 3.4 and 4.2. The AC "prove on S4 prod-class proxy, scratch only" maps to D5/C3 and tasks 1.x/4.x.
- **Placeholders:** none found. The "escalate if the premise does not hold" stop (1.3) is concrete.

### Verdict: CONFIRM

### Non-blocking notes

- **Observing `nextDue` in 3.1.** `nextDue` is private. Observe "leaves nextDue unchanged" behaviourally: count repository calls, then check that after the first pass releases, the next pass runs exactly when that pass's outcome says it should. Do not add a test-only accessor (C1).
- **Releasing the flag.** Release it with an `andThen`/`transform` on the full returned future (after the payload part), not on the history part alone. Otherwise the payload purge could overlap a second pass.
- **Scheduler test 3.2.** The "never-completing" pass should come from a `purgeIfDue` override that returns an unfulfilled Promise's future. The red is the tick future not completing within the test's bounded await, so no real sleeps are needed.
