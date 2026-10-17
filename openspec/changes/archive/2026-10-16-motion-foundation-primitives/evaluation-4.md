## Evaluation Report — Cycle 3, integration re-check (evaluation-4.md)

Reviewed HEAD: `0a07c6e7081a46f250d50be290d6b744407b8506`. That is the merge of `45cf6253d` (archive) with
`0d8bd55cf` (origin/main, HEL-1575 plus HEL-1619). The review base was resolved live to `0d8bd55cf`. Evidence is in
`/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/eval4-*` (`<ev>` below).

### Phase 1: Spec Review — PASS
Issues: none.

**1. The squash and the merge lost nothing.**

- `git diff 05a5634d0 f2ba0b9c3` touches only two files, both handoff files in the change dir:
  - `files-modified.md` (+55)
  - `skeptic-final-2.md` (+117)

  No code differs between the skeptic-CONFIRMed head and the squash.
- `f2ba0b9c3..45cf6253d` (the archive commit) is exactly this:
  - 15 `R100` renames into `archive/2026-10-16-motion-foundation-primitives/`;
  - deletion of the `files-modified.md` handoff;
  - sync of the three spec deltas into `openspec/specs/`: `appearance-preferences` modified, `echarts-chart-panel`
    modified, `motion-primitives` added.

  Nothing outside `openspec/` changes.
- `0a07c6e70` has parents `45cf6253d` and `0d8bd55cf`. I recomputed the merge with
  `git merge-tree --write-tree 45cf6253d 0d8bd55cf`:
  - It reported conflicts only in `elevationTokenGuard.css.test.ts` and `motionTokenGuard.css.test.ts`.
  - It auto-merged `DESIGN.md`, `AppRail.css` and `DashboardList.tsx`.
  - Diffing that auto-merge tree against `0a07c6e70` shows only the two conflict resolutions. No other content was
    added or dropped during the merge.

**Constraints.** C1, C2 and C3 are honoured at the merged head:

- C1 is covered by the real-browser chart entrance / no-replay test.
- C2 is covered by the grid tests that check either stylesheet order.
- C3 is covered by the shrink test and the layout, chart-fit and table-overflow sweep. Both were re-run below.

The driver-brief run constraints also hold:

- There is no diff to `PanelGrid.tsx` or `DesktopPanelGrid.tsx`.
- The tab strip is not a consumer: `git diff 0d8bd55cf 0a07c6e70 -- frontend/src/features/dashboards/tabs` is empty.

### Phase 2: Code Review — PASS
Issues: none blocking.

**2. The CSS-count pins are exact and were not loosened.**

- `find frontend/src -name '*.css' -type f | wc -l` gives 148, and so does `git ls-tree` at `0a07c6e70`. origin/main
  has 146.
- The only added CSS files are `shared/motion/motion.css` and `shared/ui/Crossfade.css`, so 146 + 2 = 148.
- Both guards pin `expect(files.length).toBe(148)`. That is an exact `toBe`, and their `allCssFiles` walk is the same
  recursive `.css` walk that `find` does.
- The conflict resolution changed only the comment and the number. The motion guard's diff against main still removes
  the `PANEL_GRID_EXCEPTION`. That removal was reviewed in cycles 1 to 3 and tightens the guard: PanelGrid.css now has
  zero literals, which `motionTokenGuard.css.test.ts` asserts.

**3. HEL-1575's work is untouched.**

- `git diff --stat 0d8bd55cf 0a07c6e70` shows no change to any of these:
  - `frontend/src/features/dashboards/tabs/**`, including `DashboardTabBar.tsx/.css`;
  - `app/dashboardChrome.ts`;
  - `app/hidesBreadcrumbItemName.ts`;
  - `DesktopPanelGridSkeleton.tsx` (the dashboard-keyed skeleton grid, at line 55);
  - `PanelGridSkeleton.tsx`;
  - `PanelList.tsx` (the `key={selectedDashboardId}` on PanelGrid).
- Under `features/panels/ui/grid/`, the diff against main is `PanelGrid.css` plus its own new test,
  `PanelGrid.css.test.ts`. That test is a test-only file of this branch, carried unchanged since the reviewed head. It
  is not a change to any grid component.
- The PanelGrid.css diff is the reviewed token timing and specificity overrides (C2). It does not touch the keying.

**Gates, fresh, run in WORKTREE_PATH on `0a07c6e70` under nice 19:**

| Gate | Result | Log |
| --- | --- | --- |
| `npm run lint` | rc=0 | `<ev>/eval4-lint.txt` |
| `npm run typecheck` | rc=0 | `<ev>/eval4-typecheck.txt` |
| `npm run format:check` | rc=0 | `<ev>/eval4-format.txt` |
| `HELIO_JEST_MAX_WORKERS=2 npm test` | rc=0: root 61 suites and 524 tests, frontend 673 suites and 7932 tests, all passing | `<ev>/eval4-jest.txt` |
| `npm --prefix frontend run build` | rc=0 | `<ev>/eval4-build.txt` |

No backend files changed, so `sbt testFull` was not required.

### Phase 3: UI Review — PASS
Issues: none attributable to this branch. One pre-existing HEL-1575 test race is described below.

**Servers.** I started 7005 and 9912 with `start-servers.sh`, and `assert-phase.sh servers` printed PASS. The backend
started at 14:08, after the 13:30 merge commit. `GET /api/dashboard-changes` returns 401, not 404, so the running
backend includes HEL-1575's route. I stopped both servers with `stop-servers.sh` when done.

**5. Requested e2e** (flock, 2 workers, nice 19; `<ev>/eval4-e2e.txt`). The run covered both hel1573 specs, the four
hel1575 specs, hel1574-shell-rail and hel1572-appearance-preferences: 71 passed, 1 skipped, 1 failed.

- The skip is `hel1575-switch-measurement`, behind its opt-in `HEL1575_MEASURE` guard.
- The failure is `hel1575-dashboard-tabs.spec.ts:593`, "an expired tab (16 minutes) refetches its panels".
  - Re-running it with `--repeat-each=4` gave 3 passed and 1 failed (`<ev>/eval4-e2e-expired-rerun.txt`).
  - That is 2 failures in 5 runs, so the test is intermittent.

**Root cause of the intermittent failure.** I read it from the failing run's trace (`<ev>/eval4-expired-tab-race.txt`):

1. `page.clock.fastForward("16:00")` fires the 2-minute `SIGNALS_REFRESH_INTERVAL_MS` interval
   (`tabsBrowserTriggers.ts:92-94`).
2. That issues `GET /api/dashboard-changes`. The response took 33.9 ms and arrived about 19 ms before the test's click
   on tab B.
3. `refreshChangeSignals.ts:22` recomputes `serverOffsetMs = serverNow - Date.now()`. `Date.now()` is the faked clock,
   16 minutes ahead, while `serverNow` is real. The offset becomes about -16 min, which cancels the fast-forward.
4. `isTabWarm` therefore still sees B inside the TTL and serves the warm copy. No panels request is made.

This is a race between HEL-1575's own test and HEL-1575 code. HEL-1573 changes none of the files on that path. Every
motion-related test in the same run passed.

**C3 re-verification at the merged head** (`<ev>/eval4-e2e-c3.txt`): 71 passed, rc=0. HEL-1575 changes how panels
mount (warm cache, keyed grid), so the wrapper-around-every-panel-body check was worth repeating. The sweep covered:

- hel1023 breakpoint layout;
- hel1304 chart types;
- hel1305 time axis;
- hel1392 remount staleness;
- hel1398 and hel1444 chart canvas;
- hel1510 table overflow;
- hel1512 category axis;
- hel813 mobile touch targets;
- hel909 picker sheet.

The hel1573 shrink-after-load test also passed in the main run.

**4. Primitives alongside the tabs, on the running app.** I checked these in the Playwright MCP browser as a throwaway
user, in light and then dark theme:

- **Tab switching:** six tab switches in light and four in dark between "E4 Primary" and "E4 Alpha".
  - Each switch rendered the right dashboard.
  - Crossfade wrappers were present (3 on Primary).
  - The chart canvas stayed inside its card, 21 px from the right edge every time.
  - There were no console errors and no update-depth loop.
- **Rail indicator:** it slides 108 to 152 px on the Data Sources click and back from 152 to 108 px on Dashboards,
  sampled every 30 ms and settling on the item. The open tabs persisted across that navigation.
- **Segmented control (Density, dark theme):** the indicator slides from x=4 to x=124 over the sampled frames.
- **Adding a dashboard from the list (dark theme):**
  - The new row ran `motion-enter` (stagger, 280 ms, `translateY(6px)` to none).
  - Siblings ran the WAAPI layout slide (280 ms, `translate(0, 151px)` to 0) as the create form closed.
  - The new dashboard opened as a third tab.
- **Metric tween:** the metric showed 1,805. The tween itself is proven by the hel1573 primitives matrix (4 modes x 2
  themes), which passed at this head.
- **Chart entrance:** proven by the passing hel1573 C1 test.
- **Screenshots:** `<ev>/eval4-light-primary.png` and `<ev>/eval4-dark-tabs.png`.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **File a follow-up against HEL-1575, not this branch, for the intermittent `hel1575-dashboard-tabs.spec.ts:593`.**
  The cleanest fix is in the test: pause the change-signal interval, or advance the clock in a way that does not let a
  signals refresh re-sync `serverOffsetMs` before the click. A product-side option is to make the offset resync
  monotonic-safe. The failure rate here was 2 in 5 runs, so it will show up in CI.
- The executor's `<ev>/e2e-integration.txt` is two summary lines and names no specs. That leaves no record of which
  specs it covered, and this run's evidence replaces it.

### Throwaway data
- **e2e runs:** each Playwright run registered `@example.test` throwaway users and deleted them itself (the
  "[HEL-1301 e2e] deleted N recorded throwaway user(s)" lines in each log).
- **Manual check:** I created user `eval4-hel1573-1792186262476@example.test` on the shared dev DB. It owns:
  - dashboards "E4 Alpha", "E4 Beta", "E4 Primary" and "E4 Aardvark";
  - static source "E4 source";
  - pipeline "E4 pipeline";
  - outputs "E4 metric", "E4 chart" and "E4 table";
  - 3 panels on "E4 Primary".

  These are not deleted.
- The Playwright MCP tool wrote its own snapshot and console logs to `/home/matt/Development/helio/.playwright-mcp/`
  (gitignored, timestamps 2026-10-16T21-30 to 21-32).
