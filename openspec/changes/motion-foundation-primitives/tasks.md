## Standing Constraints

- [C1] Chart entrance timing and no-replay are proven in a real browser; jsdom reads every token as 0 and cannot prove motion timing
- [C3] Any wrapper placed around every panel body is verified against the existing panel layout, chart-fit and table-overflow e2e specs, including a shrink-after-load case
- [C2] Every override of react-grid-layout vendor CSS wins by selector specificity, never by stylesheet import order

## Run constraints (driver brief, binding)

- No edit to `PanelGrid.tsx` / `DesktopPanelGrid.tsx` and no layout-motion wiring inside the grid without escalating.
- Never use the dashboard tab strip as a consumer (HEL-1575 owns it).
- One motion reader (D1); never add a second way to read `data-motion` / the OS setting.
- Scratch only `/home/matt/Development/helio/.concertino/scratch/HEL-1573/`; evidence `.concertino/runs/HEL-1573/evidence/`.
- Check `/proc/loadavg` before heavy runs (1-min > 10: wait 60s, up to 30 min); jest/Playwright max 2 workers; `nice -n 19`.
- Full Playwright suites under the e2e flock; never kill/pkill/pgrep; stop servers only via stop-servers.sh.

### Frontend

## 1. Reader and tokens

- [x] 1.1 Add `useMotion()` to `ThemeProvider.tsx`, derive `useReducedMotion` from it; verify ThemeProvider tests
- [x] 1.2 Add `--motion-duration-move` / `--motion-rise-distance` with Subtle and both Off overrides; verify token CSS tests
- [x] 1.3 Add `shared/motion/motionTokens.ts` `readMotionDuration`; verify unit test (ms, s, unresolved -> 0)

## 2. Primitives and consumers

- [x] 2.1 Staggered entrance (`motion.css` `.motion-enter`, `useStaggeredEntrance`) on `DashboardList`; verify unit test
- [x] 2.2 `useLayoutSlide` FLIP on `DashboardList` rows; verify unit test (no animate call at duration 0)
- [x] 2.3 `useValueTween` in `MetricRenderer`; verify unit test (first value instant, settles exact, Subtle/Off instant)
- [x] 2.4 `Crossfade` around `PanelContent` skeleton -> body; verify unit tests (unmount on transitionend, transitioncancel, no-animation path; aria-hidden+inert)
- [x] 2.5 `useIndicatorSlide` in `AppRail` and `SegmentedRadioGroup`; verify unit tests, existing rail/segmented tests green

## 3. HEL-1032 and HEL-1034

- [x] 3.1 `PanelGrid.css` per D9 selectors (specificity table), real vendor none-states; drop guard exception; verify motionTokenGuard
- [x] 3.2 `applyChartMotion` + `entranceDoneRef` (finished event / elapsed) in `ChartPanel`, `UsageChart`; verify unit tests per mode
- [x] 3.3 Subtle opacity-only variants in toast.css, MobileNavSheet.css, RefinementChatDrawer.css; verify CSS tests

## 4. Docs

- [x] 4.1 DESIGN.md §10: primitive APIs, role tokens (6px, no scale), Subtle as implemented, shorthand aliases, notMerge note, Known gap closed

### Tests

## 5. Verification

- [x] 5.1 Guard test: no literal durations under `shared/motion/**` and primitive CSS; verify it fails on a planted literal
- [x] 5.2 Playwright spec (D12): Off and OS-reduce (server motion null), light+dark, incl. grid items; Full control animates; grid none-states; chart timing (C1)
- [x] 5.3 Real-browser screenshots/recordings of each primitive (Full, Subtle, Off; both themes) into evidence
- [x] 5.4 Real drag/resize on the running app at the new grid timing; note feel + dragging item tracks pointer (note: `.concertino/runs/HEL-1573/evidence/5.4-drag-resize-feel-note.md`)
- [x] 5.5 Full frontend gates: lint, typecheck, format:check, jest (2 workers), affected e2e
