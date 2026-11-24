## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 95cd05307ebccbacb8f573cd9732ec59a3ec2e79. Base resolved live with `resolve-review-base.sh`:
0548a46403a1f3a5cc85e79519a4945ff0e6c2d4. Spawn-cwd guard: READY.

### What I verified (with evidence)

**The diff.** `git diff 0548a4640...HEAD` has 3 code files:
- the one-line key change in `DesktopPanelGridSkeleton.tsx`. The key is `${dashboardId}:${activeBreakpoint}` instead of
  the dashboard id alone, and a comment explains why.
- the new jest guard `DesktopPanelGridSkeleton.loadBreakpointChange.test.tsx`.
- the new e2e `e2e/hel1835-no-update-depth-loop-on-load.spec.ts`.

There is no backend, schema or real-grid (`DesktopPanelGrid`) change, no console filtering and no width special case.
`activeBreakpoint` is derived from the measured width for any viewport.

**Root cause (systematic-debugging law).** `evidence/root-cause.md` records a probe on main. Its trace counts
renders, and the counts name the skeleton `Responsive` as the instance that loops: 446 renders without `onDragStart`,
against 6 for the real grid. The trace also shows the sequence: one render changes both the width/breakpoint
(1280→928, md→sm) and the layouts (3→9 stubs). That is the HEL-1575 library shape, and the dashboard-id key did not
cover it because the id did not change.

The ticket's column-gap premise was refuted by a matrix: the loop occurs with no gap, and does not occur when `md` is
stored. H2 and H3 are rejected with reasons. The fix is aimed at the confirmed cause: a breakpoint change now remounts
the static placeholder instead of updating it.

**Red first.**
- Commit 855ec65c5 adds the e2e and does not touch the skeleton source (`git show --stat`).
- `evidence/red-e2e-run{1,2,3}.txt` show sm and lg red with 3-4 "Maximum update depth" errors each. md is green there,
  as expected: its pre-measure breakpoint is the same as its measured one.
- `evidence/mutation-e2e.txt` and `evidence/mutation-jest.txt` (`LOOP: the skeleton grid never settled`, 2 failed) show
  red when the fix is reverted.
- The jest guard was committed with the fix, not before it. Its red is shown by `red-jest.txt` and `mutation-jest.txt`.
- I did not re-run the mutations myself, because I must not modify code. The evaluator also ran the before/after
  file-swap independently (evaluation-2.md: 2 errors with main's file, 0 with HEAD's).

**Gates I re-ran myself** (servers started via `start-servers.sh` on `helio_hel1835`; `assert-phase.sh servers`
printed PASS):
- `npx jest src/features/panels/ui/grid` (3 workers): 41 suites, 250 tests passed. This includes the new guard and the
  `layoutCommit`/`unmountFlush` tests.
- The new e2e twice (`DEV_PORT=7267`, 2 workers, lane DB): 3/3 passed each run (sm/md/lg). Output is in
  `/home/matt/Development/helio/.concertino/scratch/HEL-1835/skeptic-final-e2e.txt`.
- The PATCH regex in the e2e matches both of the app's dashboard PATCH paths, `/api/dashboards/:id` and
  `/api/dashboards/:id/update` (`dashboardService.ts:39,47,64`). The window is 3 s after the grid is ready, well
  short of the 30 s auto-save (C3).

**AC trace.**
- AC1, a test that fails first: the e2e is red on unfixed code and green after the fix. Shown by the red/green/mutation
  evidence plus my two green runs.
- AC2, the HEL-1575 and HEL-1624 load specs still pass: `evidence/regression-e2e.txt` shows 29 passed and 1 skipped.
  The skip is the measurement spec `hel1575-switch-measurement`, which is skipped by design. I relied on that pasted
  output.
- Driver addition, no silencing and no viewport case: confirmed from the diff.
- Driver addition, no layout PATCH: asserted in the e2e at all three widths.
- Driver addition, before/after at sm: the evaluator's four geometry dumps are identical, and so is my own load (below).
- Driver addition, library change escalated: not needed. The fix is helio-side.

**UI check (my own).** I loaded the reproducing dashboard (9 text panels, `md`/`xs` empty, `sm` with gaps) in the
shared browser on port 7267 at 1280x1000, which gives `sm`. There was no dialog and the page was on the lane port.
- The console had 0 errors.
- 9 grid items rendered at the stored sm positions: the column gap is right of T1, T3 and T6, and T4 is full width.
- Screenshot ref:
  `/home/matt/Development/helio/.concertino/runs/HEL-1835/evidence/.concertino/scratch/HEL-1835/skeptic-final-sm-a.png`.
- A reload at 1900 wide (`lg`) also logged 0 console errors.
- The change has no styling surface. The skeleton is the same component and config, only remounted, so DESIGN.md
  token, spacing and parity concerns do not arise. For light/dark parity I relied on the evaluator's identical
  light/dark dumps, which are content-comparable rather than mtime-based.

**Cleanup.**
- My throwaway user `9a7912d8-239a-4bea-a49d-6bf4993d7f38` was deleted by exact id with `buildUserDeleteSql`. A
  follow-up query shows 0 rows for that user and for its dashboard.
- The browser is back on about:blank.
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=7267,10174`).

### Verdict: CONFIRM

### Non-blocking notes
- The PR body should say that the ticket title's "column gap" premise was refuted and that the trigger is an empty,
  derived breakpoint layout combined with a pre-measure/measured breakpoint mismatch. The loop occurs at sm and lg.
- The no-layout-PATCH assertion is a guard that has never been seen failing. The loop never wrote a PATCH even on main
  (root-cause.md), so label it as a guard rather than a red-proven check.
- `evidence/before-after/README.md` mentions `*.png` files that are gitignored. Persist them or reword the README.
- In the e2e, the helper named `it` shadows the conventional test alias. `item` would read better.
- No gate defect: no report I relied on rests on mtime ordering.
