## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 91a08dccd70827ede3c4165e7a65963634354b80 (base 0548a46403a1f3a5cc85e79519a4945ff0e6c2d4, resolved live).
Commits: 855ec65c5 (red), 91a08dccd (fix).

### Phase 1: Spec Review — FAIL

The fix and tests are sound. I verified them myself (see Phase 2). The failures are a task that is marked done but
was not done, and planning artifacts that still describe the refuted premise.

- AC1 (a test that fails first, no "Maximum update depth" on a full load): met. The red evidence is committed in
  855ec65c5, before the fix. Re-verified by mutation (Phase 2).
- AC2 (the HEL-1575 and HEL-1624 load specs still pass): met. I re-ran `e2e/hel1575-*` and
  `e2e/hel1624-direct-load-selection.spec.ts`: 29 passed, 1 skipped (the opt-in `hel1575-switch-measurement`
  spec), 0 failed.
- Driver addition "remove the loop, not silence it; no viewport special case": met. The skeleton `Responsive` is
  keyed by `${dashboardId}:${activeBreakpoint}`, so a load never changes breakpoint and layouts in one render of a
  live instance. Nothing filters the console and nothing is tied to a width.
- Driver addition "no extra layout PATCH during load": met for the measured window (3 s after the grid is ready,
  well short of the 30 s auto-save, as C3 requires). The regex matches both client layout-write URLs
  (`dashboardService.ts:47` `PATCH /api/dashboards/:id` and `:64` `.../update`) and nothing else.
- Driver addition "show a before/after check at `sm`" / design D4 / **task 3.5: NOT DONE, but marked `[x]`.**
  `tasks.md` 3.5 says before/after screenshots at sm in both themes with identical positions. No such artifact
  exists in `evidence/` or `.concertino/runs/HEL-1835/evidence/`, and the executor reports it did not take them.
  The e2e geometry assertion proves the AFTER positions equal the stored sm positions. Nothing records the BEFORE
  positions (on main the sm test fails at line 113, before its geometry block runs). So "no visual change" has not
  been measured.
- Planning artifacts vs what was found: **stale.** `evidence/root-cause.md` refutes the ticket's premise. The column
  gap is not the trigger: a layout with no gap reproduces, 4 errors. The trigger is a stored `md` layout that is
  empty (derived at render), with several panels. The SKELETON grid's first render at the pre-measure width (1280,
  `md`) is followed by one render that changes both breakpoint and layouts. Mutation also reproduces it at `lg`
  (1900 window), not only at `sm`. The artifacts still describe the gap:
  - `proposal.md:3-4` ("Why") still says layouts "that leave a column gap" cause it, and "What Changes" points at
    `DesktopPanelGrid`.
  - `specs/breakpoint-layout-resolution/spec.md:10`: the only sm scenario is "sm layout with a column gap". The
    actual reproducing condition (an empty stored breakpoint derived at render, where the active breakpoint at the
    measured width differs from the pre-measure one) is not stated as a scenario. The requirement text itself is
    general ("any valid stored layout") and is accurate.
  - The e2e header comment and the jest comment DO describe the real cause correctly.
- Scope: no scope creep; one component line changed plus tests and evidence.
- CONSTRAINTS C1-C3: C1 honoured (the red reproduced 3/3, nothing was green from the start). C2 honoured
  (root-cause.md names the skeleton by trace: 446 renders of `ResponsiveGridLayout` without `onDragStart` against 6
  with it). C3 honoured for the test. The PR body is not written yet, so its claims are unchecked.

### Phase 2: Code Review — PASS

I ran every gate myself in the worktree at 91a08dccd. Output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1835/eval-*.txt`.
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test` (3 jest workers): root 76 suites / 683 tests, and frontend 935 suites / 10847 tests, all passed.
- New e2e, `--repeat-each=3`, 2 workers, lane DB: 9/9 passed (sm/md/lg x3).
- E2e mutation (key reverted to `dashboardId ?? "no-dashboard"`, file restored with `git checkout` afterwards, tree
  clean): sm 2/2 and lg 2/2 failed, all at the assertion `spec.ts:113` (3 "Maximum update depth" errors each). md
  2/2 passed, matching the executor's own mutation evidence (md does not cross a breakpoint from the pre-measure
  1280).
- Jest mutation (same revert): both tests in `DesktopPanelGridSkeleton.loadBreakpointChange.test.tsx` fail with
  "LOOP: the skeleton grid never settled". Restored: 9/9 passed in the skeleton test files.
- Code quality: the change is minimal and placed at the confirmed cause. The comment explains why the breakpoint is
  part of the key and why remounting a static placeholder is safe (it has no drag or staged state). The real
  `DesktopPanelGrid` is untouched, so the risk the design names (drag state lost on remount) does not arise. No
  dead code, no `any`. Lint passed under the zero-warnings policy.

### Phase 3: UI Review — PASS (objective checks only)

- Servers were started with `start-servers.sh` on 7267/10174 and the lane DB `helio_hel1835`, with
  ANTHROPIC_API_KEY empty. I used the shared MCP browser on port 7267 only; no dialog was open. Through the API I
  seeded the reproducing dashboard: 9 text panels, sm with gaps, md/xs `[]`.
- Full load at 1280 (sm), 1100 and 768 windows: 0 console errors at each. The panels render at the stored sm
  positions at 1280. This is a dark-theme spot check only, not the before/after comparison (CR 1). The e2e covers
  1500 (md) and 1900 (lg) with 0 errors and no layout PATCH.
- The throwaway user was deleted by exact id with `deleteUsersAndFolders`, and the servers were stopped with
  `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. **Do task 3.5 / D4 / the driver's "before/after check at sm", or stop marking it done.** Produce a
   self-authenticating before/after comparison of the reproducing dashboard at the sm viewport (1280x1000), in both
   themes:
   - BEFORE on 0548a4640 (after the loop settles).
   - AFTER on HEAD.
   - Per-panel `getBoundingClientRect` dumps (title → x/y/w/h relative to `.panel-grid`), diffed, are preferred to
     screenshots, which may accompany them.
   Persist the dumps with `persist-evidence.sh` and cite the `ref=` paths. If this cannot be done, uncheck
   `tasks.md` 3.5 and say why in tasks.md and the PR body. A `[x]` on undone work is not acceptable.
2. **Make the planning artifacts match the root cause actually found.**
   - `proposal.md:3-7` ("Why"): state that the column gap was refuted as the trigger. The real trigger is a stored
     breakpoint layout that is empty (derived at render), on a load where the skeleton grid's pre-measure
     breakpoint differs from the measured one. Seen at sm and lg.
   - `proposal.md` "What Changes" / "Impact": name `DesktopPanelGridSkeleton.tsx` as the fixed file.
   - `specs/breakpoint-layout-resolution/spec.md:10-13`: rename or retarget the sm scenario so it describes the
     reproducing condition rather than "a column gap", e.g. "WHEN a dashboard whose stored layout for the active
     breakpoint differs from the one the pre-measure width selects (e.g. `md` stored empty, `sm` authored) is loaded
     ...". Optionally keep the gap as one example.

### Non-blocking Suggestions
- The no-PATCH assertion is a guard that has never been shown red. Note it as an unexercised guard in the PR body
  (C3: claim only what was measured), or show it red once with a deliberate layout write during load.
- `e2e/hel1835-...spec.ts:23` names a local helper `it`. That reads like a test-runner global; `item` (as the jest
  file uses) is clearer.
- The PR body should state plainly that the ticket title's "column gap" premise was refuted. A reader of the HEL-1835
  title will otherwise look for gap-specific handling.
- `stop-servers.sh` printed "note: refusing to signal pid 65347" and then `STOPPED ports=7267,10174`. Recorded for
  the orchestrator; ports were reported freed.
