## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `d0b3f334f8ab65a1a58142a7a012b5e80748ce74` against the live-resolved base `60086f02bb5b1ee48f2246bc09e3e66349199585`.
The cycle-2 delta is `1fef1d5a2..d0b3f334f`. Scope is still Phase A only. Phase B (tasks 2.1, 2.2, 3.3) waits on
HEL-1575 and was not counted against this verdict.

### Fresh evidence (my own runs)

- Backend main code is unchanged this cycle. `git diff --name-only 1fef1d5a2..HEAD -- backend` lists only
  `backend/src/test/.../FireTimeRunConfigGateSpec.scala`. So cycle 1's full sbt shards still cover `backend/src/main`:
  1083, 2334, 2552, 2101 and 73 tests, all with `failed 0`.
- Services shard, re-run in a clean detached worktree at `d0b3f334f`: 2101 succeeded, 0 failed, 4 canceled (the
  existing `HELIO_MEASURE` report-only tests). The new FireTime case ran and passed.
- `npm run lint`, `format:check`, `typecheck`, `check:schemas`, `check:tokens`, `check:openspec`,
  `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: all exit 0.
- `npm test` (3 workers): root 469 tests, frontend 7367 tests, 0 failed. Frontend build: exit 0.
- **Full Playwright e2e suite at 2 workers, this head, servers 7010/9917: `310 passed (14.7m)`, exit 0.**

### Phase 1: Spec Review — PASS

Issues: none.
- CR1 brings the home-page "Designed states" requirement into line: loading shows skeletons, and a failed load shows
  an error with a retry.
- Constraints C1–C5 are still honored. C5: `submitPipelineRun` is untouched.
- The Phase B seams are unchanged from cycle 1, which verified them.

### Phase 2: Code Review — PASS

- **CR3 (prune guard): fixed and failable.**
  - The test now seeds 14 runs that are 3 days old, then runs 12 scheduled skips.
  - It asserts that no run older than 24h survives and that all 12 fires do.
  - My own red mutation, in a throwaway worktree that I removed afterwards: with `if (false && pruneOldRuns && ...)`
    in `PipelineRunService.recordUnrunnable`, the test FAILED with `14 was not equal to 0
    (FireTimeRunConfigGateSpec.scala:282)`, 9 passed / 1 failed. Restored, it is green.
- **Queued refetch: sound.**
  - `loadHomeSummary({queueIfBusy: true})` with `dispatchConditionRejection` sets `refetchQueued` when the request is
    skipped because another is in flight.
  - `pending` clears that flag, and `HomePage`'s effect fires one trailing refetch once `inFlight` drops.
  - The plain mount and visibility refetches still dedupe, so cycle 1's single-request property is preserved.
  - Unit tests were added.
- **CR2 tokens:** `:root[data-theme="dark"]` overrides set `--app-surface-strong` on the secondary/ghost buttons,
  timeline marks and Up next rows. That matches DESIGN §3's HEL-866 table and the existing precedents.

### Phase 3: UI Review — PASS

All live checks ran on a throwaway user seeded with one unresolved failed run, one succeeded run and a 3h schedule.
- **CR1, loading** (summary held open): Needs attention and Up next show only `role=status` skeletons (2 status
  regions). Neither "Nothing needs attention" nor "Nothing is scheduled" appears.
- **CR1, failed** (summary 500): Needs attention reads "Not available right now." with Try again, and Up next reads
  "Not available right now.". No false claim remains.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/openspec/changes/home-page-run-timeline/eval-2/c2-fail-dark-1280.png`
    (loading: `.../eval-2/c2-slow-dark-1280.png`).
- **CR2, dark hover** (re-measured live on `rgb(26,24,22)` cards): hovered Retry, Open, a timeline mark and an Up next
  row each paint `rgb(38,35,32)`, which is **1.1328:1**. Cycle 1 measured 1.03:1. The guard threshold is 1.10.
- **CR4, guard coverage on `/home`** (both themes, in my full e2e run):
  - focus-presence guard: 19 focusable elements measured in each theme.
  - HEL-866 state guard: 16 probed, 16 resolved, 0 unresolved, 6 pass, 0 fail (`unresolvedFraction=0.000`).
- **Queued refetch, live:**
  - Setup: `home-summary` delayed 3s and the run POST mocked to resolve after 1s.
  - Steps: click Retry, then fire a `visibilitychange` 0.3s later so a summary request is in flight when the run
    returns.
  - Result: exactly **2** summary requests (the visibility one plus one trailing). Before the fix the post-Retry
    refetch would have been dropped.
- The throwaway user was deleted by exact id and email through `buildUserDeleteSql`; a count afterwards found 0 rows.
  Servers were stopped with `stop-servers.sh`.

### Overall: PASS

### Non-blocking Suggestions

- On a failed first load, three cards show "Try again"/error copy at once: the opening line, the timeline and Needs
  attention. One shared retry would be quieter. The timeline error still prints the raw server message ("boom") in
  muted text (DESIGN §7 intent styling).
- Cycle 1 suggestions that are still open: split `HomePage.css` by component; `RunDisclosureList` uses
  `aria-controls` while collapsed and repeats the link name "Open pipeline"; Up next has no day cue; list the
  observed `/home` request set in the PR.
