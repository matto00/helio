## Context

See proposal.md (Why). The root causes are unknown at planning time; this design fixes the method, the evidence
standard, and the decision rules, not the fix itself.

- `e2e/hel1575-dashboard-tabs.spec.ts` runs `mode: "parallel"`. Test A ("an expired tab (16 minutes) refetches its
  panels", line 593) installs `page.clock`, opens tabs A and B, fast-forwards 16 minutes, and expects B's switch to
  refetch panels and rows. HEL-1681 already rewrote `serverNow` on `/api/dashboard-changes` after the jump to stop a
  server-clock-offset race ("1 run in 8 under 2 workers").
- Test B ("logout clears the browser-stored warm copy", line 641) opens three warm tabs, signs out, and polls the
  `helio-warm` IndexedDB entry count to 0. Logout calls `clearWarmState` via `clearWarmHook`/`awaitWarmClear`
  (`authSlice.ts`), which bumps a store epoch, cancels queued writes and deletes the database
  (`warmCache.ts`, `boundedWarmStore.ts`, `warmStore.ts`). A write that lands after the delete, or a delete blocked by
  an open connection, would leave entries behind.
- There is no e2e flock lock. Other lanes run backend tests concurrently on the same machine.

## Goals / Non-Goals

**Goals:** a probe-confirmed root cause per test; a red-first reproduction; a minimal fix at the layer where the
defect lives; 40/40 green per test after the fix.

**Non-Goals:** see proposal.md Non-goals.

## Decisions

0. **Read the recorded failures first.** Before any local run, read the failed CI job log for test B at d777803c1
   (run 38987195427: `gh run view 38987195427 --log-failed`; `gh run list` needs the full SHA
   `d777803c1fbdf45f093584527ed4c052c8ad992f`, a short SHA returns an empty list) and any recorded failure of test A, and
   record the assertion text and failing step in `repro.md`. CI uploads no traces, but the log says which step failed
   (`waitForURL`, the count poll stuck at N > 0, or the `>= 1` precondition), which orders the probes. An empty
   result is an error to investigate, never a finding. HEL-1631 (c1add2394) changed logout after that failure, so
   `repro.md` notes that the measured tree differs from the one that failed in CI.
1. **Measure on current main first, against this lane's own servers.** Start servers with
   `scripts/concertino/start-servers.sh` on DEV_PORT 7076 / BACKEND_PORT 9983 and confirm with
   `scripts/concertino/assert-phase.sh servers <WORKTREE_PATH> 7076 9983 HEL-1644`. Every Playwright run sets
   `DEV_PORT=7076 BACKEND_PORT=9983` explicitly on its command line (`playwright.config.ts` otherwise falls back to
   5173, another lane's server; MISTAKES.md CON-165). Run each test alone (`-g "<exact title>"`) with
   `--repeat-each=40 --workers=2 --trace retain-on-failure` under `nice -n 19`, on an unmodified tree, before any
   edit. `repro.md` records each exact command line including env assignments, the pass/fail counts and `uptime`.
   Alternative (start from a hypothesis) is rejected: the ticket's first hypothesis for test A was disproved once.
2. **Reproduction budget, the same for both tests.** Raising contention is allowed; changing the code under test
   is not (a temporary probe instrument is allowed and is reverted). Steps, in order, stopping at the first failure:
   (a) the test alone, `--repeat-each=40`; (b) the test alone, `--repeat-each=200`; (c) the whole spec file,
   `--repeat-each=10`, since a cross-test interaction in parallel mode is plausible; (d) the test alone,
   `--repeat-each=100`, with 4x CPU throttling via a CDP session (a probe-only edit, reverted). Every step is
   recorded, including any probe-only diff and its revert, so the evaluator can confirm a clean tree.
   **Post-fix proof has three parts, all required.** (i) The AC's literal 40/40: the test alone,
   `--repeat-each=40`. This alone is weak: at a 1-in-40 base rate the unfixed test also passes 40/40 about 36% of the
   time. (ii) Like with like: re-run, with identical parameters (repeat count, scope, throttle), the Decision 2 step
   that first produced the failure, and require zero failures; record it next to the before count. (iii) Where the
   root-cause probe can force the race deterministically (for example, hold the `/api/dashboard-changes` response
   until after `fastForward`, or hold a warm-store write until after logout's delete), show the forced run red on the
   unfixed code and green on the fixed code. That red/green pair is what proves a test-race fix, the e2e analogue of
   Decision 4's red-first unit test for an app fix. If forcing is impossible, say why in `repro.md`, and replace
   (iii) with the test alone at `--repeat-each=200` with zero failures.
3. **Root cause by trace or probe, not by guess.** A failing trace (network log, console, DOM snapshot at failure)
   or an instrumented probe must show the mechanism. A fix whose mechanism is not shown is not accepted.
4. **Layer of the fix follows the cause.** Test race → fix the test (wait on the real signal, e.g. a specific
   response or state, never a sleep or a longer timeout). App defect → fix the app and add a unit or seam test that
   is red on the unfixed code (shown by reverting the fix) and green after. For test B an app defect is a privacy bug.
5. **Stale skeleton reads.** HEL-1633's `e2e/support/panelGridReady.ts` notes that the panel-list skeleton also
   renders `.panel-grid-card`. `expectTableRendered` filters by `hasText` and waits on cells, so the skeleton is not
   assumed to matter; check it only if a trace points there.
6. **If either test cannot be made to fail** after Decision 2's full budget on current main, stop and escalate with
   the evidence (for test A, HEL-1681 likely fixed it; for test B, the CI log from Decision 0). Do not invent a fix
   for an unreproduced flake. The executor does not raise the escalation mid-flight: it carries the other test to a
   stopping point (fixed and proven, or itself blocked), then returns one combined escalation covering both.
7. **If test B's root cause is one of HEL-1634's caches, or the fix grows beyond the warm-copy clear path**, escalate
   before implementing.

8. **Candidate mechanisms are probed, not assumed.** Examples to probe if evidence points there: test A's route
   handler reads `jumped` at response time, so a request issued before the jump whose response lands after it is
   also shifted; test A's existing `waitForTimeout(800)` at :609; for test B (CI failed at the final count poll),
   logout's `awaitWarmClear` is bounded at 1 s, so a delete or queued write outlasting that bound is a candidate.
   Note `-g` takes a regex: escape test A's parentheses (`-g "an expired tab \(16 minutes\)"`). After reverting any
   probe edit, record `git diff --stat` in `repro.md` as clean-tree evidence. If the fix rewrites test A, waits use real signals.

9. **Owner ruling after Decision 6 escalation (2026-11-16).** Test A closes as fixed by HEL-1681; its
   failing-first AC is dropped. Test B: the CI failure was a post-logout navigation destroying the `page.evaluate`
   context; force that race (candidate: the 401 interceptor's `window.location.assign("/login")`), show red, fix the
   test to wait for navigation to settle, show forced green plus 40/40. No red, or an app defect, escalates.

## Risks / Trade-offs

- [A 1-in-40 flake may need many runs to show] → Decision 2's bounded escalation of run count and contention.
- [Shared machine load changes flake rates] → record load (`uptime`) with each run; compare like with like.
- [Test-only fix hides an app defect] → Decision 3: the mechanism must be shown before choosing the layer.

## Planner Notes

- `TICKET_TYPE: feature` in workflow-state.md is the workflow's binary design/non-design flag; a bug ticket is
  "feature" there by definition. The branch prefix `bug/` carries the bug classification.
- `skip_specs: true`: no requirement change expected (self-approved; revisit if the cause needs one).
- Evidence files (run logs, probe notes) live in the change dir as `repro.md`; large traces stay in
  `/home/matt/Development/helio/.concertino/scratch/HEL-1644/`, not in git.
