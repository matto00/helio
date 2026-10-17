## Skeptic Report — final gate (round 3, skeptic-final-3.md)

- **Reviewed HEAD:** `671dbc419e9b85bd5143aed3a3a2b8209a6fb87a`. HEAD was unchanged at the end of my review and the worktree was clean.
- **Diff base:** resolved live with `resolve-review-base.sh` as `0d8bd55cf23a8c2a867614d7182d748ab6dde912`, which is origin/main (HEL-1575 #1032).
- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/motion-foundation-primitives/HEL-1573`.
- **Durable evidence:** `/home/matt/Development/helio/.concertino/runs/HEL-1573/evidence/.concertino/scratch/HEL-1573/` (written `<ev>/` below).
- **Scratch from the killed sk3 spawns:** I redid every check I rely on myself. The one scratch artifact I could not account for is discussed under Non-blocking notes.

### What I verified (with evidence)

**Gates (fresh, in WORKTREE_PATH, nice 19)**

| gate | result | log |
| --- | --- | --- |
| `npm run lint` | EXIT=0 | `<ev>/sk3b-lint.txt` |
| `npm run typecheck` | EXIT=0 | `<ev>/sk3b-tc.txt` |
| `npm run format:check` | EXIT=0 | `<ev>/sk3b-fmt.txt` |
| `node scripts/check-tokens.mjs` | EXIT=0 | — |
| jest at 2 workers | root: 61 suites, 524 tests. frontend: 673 suites, 7932 tests. All passed, EXIT=0 | `<ev>/sk3b-jest.txt` |

**e2e on the integrated head**
- Run against 7005/9912 under the e2e flock, 2 workers, `--trace retain-on-failure`: **143 passed, EXIT=0** (`<ev>/sk3c-e2e.txt`).
- Scope:
  - both hel1573 specs: the 4 modes x 2 themes AC2 matrix, the C2 grid checks, the C1 chart entrance and no-replay check, and the C3 shrink-after-load test;
  - every hel1575 spec except the opt-in measurement spec, including `delayed-restore-no-update-loop`;
  - hel1574-shell-rail and hel1572-appearance;
  - the C3 layout, chart-fit and table-overflow sweep: hel1023, hel1304, hel1305, hel1392-staleness, hel1398, hel1444, hel1510, hel1512, hel813, hel909.
- **Servers:** 7005/9912 were already running. `start-servers.sh` reused them and `assert-phase.sh servers` printed PASS.
  - I confirmed through `/proc` that the vite and java processes are rooted in this worktree.
  - Both started at 14:47, after the merge commit at 13:30. 671dbc419 is doc-only.
  - `/api/dashboard-changes` returns 401, so the route exists.

**The merge integrates and does not loosen anything**
- **CSS pins are exact:** `find frontend/src -name '*.css'` gives 148; `git ls-tree` on main gives 146. The diff adds only `motion.css` and `Crossfade.css`. Both guards pin `toBe(148)`.
  - The conflict resolution changed only the count and its comment.
  - The motion guard's removal of the PanelGrid 180ms exception is replaced by a stricter assertion: zero literals in `PanelGrid.css`.
- **HEL-1575 files are byte-identical to main.** `git diff --quiet 0d8bd55cf HEAD` printed UNCHANGED for:
  - `features/dashboards/tabs/**`
  - `app/dashboardChrome.ts`, `app/hidesBreadcrumbItemName.ts`
  - `PanelGrid.tsx`, `DesktopPanelGrid.tsx`
  - `DesktopPanelGridSkeleton.tsx`, which still has `key={dashboardId ?? "no-dashboard"}` at line 57
  - `PanelGridSkeleton.tsx`, `PanelList.tsx`
- **No new layout/breakpoint render for react-grid-layout.** Under `grid/`, only `PanelGrid.css` and its CSS test changed. Nothing changes the props react-grid-layout receives. The motion consumers (Crossfade in `PanelContent`, chart entrance in `ChartPanel`, stagger and layout slide in `DashboardList`) live inside grid children or outside the grid entirely.
- **The tab strip is not an indicator consumer.** `useIndicatorSlide` / `motion-indicator` appear only in `AppRail.tsx` and `SegmentedRadioGroup.tsx`. DESIGN.md §10 states that the tab strip belongs to its own ticket.
- **Constraints:**
  - C1: the real-browser chart test passed.
  - C2: the specificity-in-either-order test passed.
  - C3: the shrink test and sweep passed at the merged head.

**Live UI checks with HEL-1575 present (7005, user `eval4-hel1573-…`, 1280 px, light then dark)**
- **Tab switching does not break chart fit.** I measured card vs. canvas over 4 Alpha↔Primary switches, a 1700→1280 resize made while the tab was hidden, and a 2500→1900 within-breakpoint resize made while the tab was hidden. The canvas stayed inside the card every time (for example, card 328–1096 and canvas 349–1075).
- **The list stagger does not replay on a tab switch:** each row had 0 running animations 60 ms after the switch.
- **The rail indicator slides:** sampled every 30 ms, its translate went 108 → 123.0 → 139.8 → … → 152 with an ease-out settle, and it returned to 108. All three tabs persisted across Data Sources → Dashboards.
- No console errors.
- **Screenshots:**
  - `<ev>/sk3c-branch-e4primary-load.png` (light)
  - `<ev>/sk3c-branch-dark-primary.png` (dark)
- **Visual judgment:** consistent with main's chrome in both themes. The rail wash sits correctly behind the active icon, and the cards, the tab strip and the meta row are unchanged. No objection.

**The `hel1575-dashboard-tabs.spec.ts:593` flake claim (evaluation-4)**

The baseline is origin/main 0d8bd55cf, served at 7015/9922 from the registered detached worktree `…/scratchpad/hel1575-main`. The spec file, `e2e/support` (except this branch's two added helpers) and `playwright.config.ts` are identical to main, so I ran the same spec file against both apps.

| app | runs | failures | log |
| --- | --- | --- | --- |
| main | 10 | 0 | `<ev>/sk3c-593-main.txt` |
| main | 30 | **1** | `<ev>/sk3c-593-main30.txt` |
| branch | 10 | 1 | `<ev>/sk3c-593-branch.txt` |
| branch | 30 | 0 | `<ev>/sk3c-593-branch30.txt` |

- That is 1 in 40 on main and 1 in 40 on the branch. The branch also passed it inside the 143-pass run.
- The main failure is the identical assertion, `:620` `expect.poll(PANELS).toBeGreaterThanOrEqual(1)` with Received 0.
- **Verdict on the claim:** the flake reproduces on main without this branch, so it is independent of HEL-1573. **Confirmed.**
- **The evaluator's specific mechanism is NOT confirmed.** Evaluation-4 says the failure happens when a signals response re-syncs `serverOffsetMs` before the click.
  - The failing branch trace does show a `dashboard-changes` request about 3 ms after `clockFastForward` and before the click.
  - But a probe that waits for that response plus 300 ms before clicking passed 4 out of 4 on main (`<ev>/sk3c-probe593-main.txt`, probe spec `<ev>/sk3c-probe/tests/probe593.spec.ts`). It is a copy of the spec in scratch, run through a scratch config.
  - So "the response lands before the click" is not by itself enough to make it fail. The real race is elsewhere in HEL-1575's path. This does not affect this branch.

**AC trace (unchanged since round 2; re-confirmed at the merged head)**
- **AC1 tokens:** `theme.css` `--motion-*`; `motionPrimitiveLiterals.test.ts` and `motionTokenGuard` are green.
- **AC2 Off and OS-reduce in a real browser, both themes:** `hel1573-motion-primitives.spec.ts:267` passed in all 8 combinations in my run.
- **AC3 unit test plus a consumer for each primitive:**

  | primitive | consumer |
  | --- | --- |
  | stagger | DashboardList |
  | layout slide | DashboardList |
  | value tween | MetricRenderer |
  | Crossfade | PanelContent |
  | indicator | AppRail and SegmentedRadioGroup |

  Each has its own `*.test.tsx`, green in jest.
- **AC4 grid:** a single `--motion-duration-move` duration, no 180 ms literals; the C2 test passed.
- **AC5 chart:** token-timed entrance with no replay on option change; the C1 test passed.

### Verdict: CONFIRM

### Non-blocking notes
- **Follow-up for HEL-1575, not this branch:** `:593` flakes at about 1 in 40 on main.
  - The ticket should not inherit evaluation-4's offset-resync explanation as established. My probe shows that a response landing before the click passes.
  - The race needs its own probe.
- **House-rule discrepancy:** the brief said a registered main worktree exists at `.concertino/scratch/HEL-1573/mainwt`. It does not exist, and `git worktree list` has no entry for it.
  - I used the existing registered detached worktree `…/scratchpad/hel1575-main` (HEAD 0d8bd55cf, clean) and its already-running servers on 7015/9922 for the baseline.
  - I did not start or stop those servers, and I did not stop 7005/9912. I left both as I found them.
- **Unexplained scratch artifact:** `scratch/HEL-1573/sk3-originmain-chart-overflow.png` comes from a killed earlier spawn. It shows a chart canvas overflowing its card at 7015 (main).
  - I could not reproduce any overflow on either main or the branch with the routes above.
  - Its provenance and route are unknown, so I gave it no weight. If it was real, it is on main, not in this diff.
- **Browser state:** I set `helio-theme=dark` in 7005's localStorage in the shared Playwright MCP browser.
- **Throwaway data:**
  - I created user `sk3c-SK3C-1792190201227@example.test` on the shared dev DB (via 9912). It owns:
    - dashboards `SK3C Alpha`, `SK3C Beta`, `SK3C Gamma`, and `SK3C Primary` (`2b1863de-edda-40db-93bb-3446386f3901`);
    - source `3810a798-…`;
    - pipeline `bf7ba7af-…` with 3 Outputs;
    - 3 panels.

    It is not deleted.
  - I also used the evaluator's existing `eval4-hel1573-…` user, read-only apart from tab switches.
  - The e2e runs deleted their own registered users.
