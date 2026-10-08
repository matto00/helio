## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `14d13a10c9b7e6712d9fb3856f021eef52bd3d4d`. Diff base resolved live:
`b14e622ee325c32569a452b6d9a8eb1d826ca76b`.

Cycle-2 delta (`290e1edf9..14d13a10c`) touches only:
- `PipelineRunServiceTerminalOrderingSpec.scala`
- `files-modified.md`
- the new `red-run-evidence-cycle2.txt`
- the committed `evaluation-1.md`

`PipelineRunService.scala` is unchanged since cycle 1.

### Fresh evidence (my own runs)

- **`sbt testFull` at HEAD (14d13a10c), in WORKTREE_PATH:** 6104 succeeded, 0 failed, 4 canceled.
  - The 4 canceled are the opt-in `HELIO_MEASURE=1` and latency report-only cases, same as cycle 1.
  - I re-ran it even though cycle 2 changed tests only. The gate has to cover the exact commit being
    certified, so I did not rely on the cycle-1 run.
- **Red re-run (C2).** I made a scratch copy of HEAD's `backend/` and swapped in only b14e622ee's
  `PipelineRunService.scala`. Result: 7 passed, 3 failed.
  - Rate limit: `Vector(RunStatusEvent("queued", ...)) was not empty`.
  - Concurrency cap: the subscriber saw a second run id's `queued`.
  - Write-back exception: `lock 'pipeline_runs row' ... never blocked a service backend -- the case
    would be vacuous`.
- **Mutation probe.** I made a scratch copy of HEAD with one change in the new `recoverWith` branch: it
  publishes `failed`, then runs `updateRunTerminal`/`updateLastRun`, then re-fails with `ex`.
  - Result: 9 passed, 1 failed. Only the write-back case failed, with
    `terminal event received while write blocked (pipeline_runs row locked)`.
  - In cycle 1 the same mutation passed this case. The gap is closed.
- My results match the executor's `red-run-evidence-cycle2.txt`.

### Is the base red still a real proof of the original bug?

Yes.
- **What the failure checks.** `awaitBlockedBy` polls for up to 15 s for any service backend blocked on
  the locked `pipeline_runs` row. On b14e622ee, a failed `applyWriteBacks` Future skips both branches,
  so the run's terminal write is never attempted.
- **What the red therefore shows.** The service never tries to move the run to `failed`. That is the
  durable half of the bug: the row stays non-terminal and keeps counting toward the HEL-505 cap.
- **Why the failure is caused by the fix's absence, not by the test setup.** The same setup does block
  on HEAD: the case is green there, and the mutation run reached `assertNoTerminalWhileBlocked`. The
  only difference between the two scratch copies is the service file.
- **What the red does not show directly.** It no longer states "no terminal event" directly.
  - That half is still covered: cycle 1's red run of the non-lock form recorded exactly that on
    b14e622ee ("no terminal event arrived", events end at node-progress). It is in
    `red-run-evidence.txt`, and I reproduced it in cycle 1.
  - The `awaitTerminal`/witness assertions that follow in the same case would also fail on base.
- Together these are a sound red for both halves of AC3. **C2 holds.**

### Phase 1: Spec Review — PASS

- All four ACs are met (see cycle 1 for AC1, AC2 and AC4).
- AC3 and design D3 are now proven deterministically. The write-back-exception case follows
  `finishFailedCase`'s lock steps:
  - `startAndLockRunRow`
  - `awaitBlockedBy`
  - `assertNoTerminalWhileBlocked`
  - a check that the run is non-terminal while the lock is held, then release
  - then: event is `failed`, `errorLog` names `upsertsource`, the run is durably `failed`, the submit
    Future fails, and exactly one `failed` is published.
- This satisfies the delta scenario: one `failed` event "published after that row is durable".
- The SSE delta's "without exposing the raw exception" clause is now asserted
  (`errorLog` must not include `"hel1370 test"`).
- `files-modified.md` now describes the test accurately, which resolves CR2.
- Constraints:
  - C1: no change to the main source this cycle.
  - C2: verified above.
  - C3: my runs used nice -n 19, with at most 3 concurrent sbt processes.

### Phase 2: Code Review — PASS

- Gates are green at HEAD.
- The test change is small. It reuses the spec's existing lock helpers, adds no new helpers, and
  duplicates nothing beyond `finishFailedCase`'s steps. Those steps had to be inlined because that
  helper's `await(submitted)` throws on the intentionally failed submit.
- The production code is unchanged and was already judged correct in cycle 1.

### Phase 3: UI Review — N/A

Backend-only.

### Overall: PASS

### Non-blocking Suggestions

- Optional, for readability: when the run row never blocks, have the write-back case's red message say
  "no terminal run-row write attempted". This would make a future base-red self-explanatory without
  cross-referencing cycle 1's evidence.
