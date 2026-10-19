## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `d91082585d3c455f4666ca42db6b0994a3a98e5c`. The base was resolved live with `resolve-review-base.sh` to `d622886dae08e927d8ebb1b0cd13bf2698e4cb83` (origin/main).
Screenshots are persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1656/evidence/.concertino/scratch/HEL-1656/skeptic/`, referred to as `SK/` below.

### What I verified (with evidence)
- **cwd guard:** `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-pull-refresh/HEL-1656`.
- **Owner ruling exists.** `events.jsonl` line 3: `escalation.answered`, answer `suppress-on-phone-dashboard`, `answer_source: human`.
- **Diff read in full.** I read `git diff $BASE...HEAD` for these files: `usePullToRefresh.ts`, `pullRefreshRegistry.ts`, `PullRefreshIndicator.tsx`, `MobilePanelStack.tsx/.css`, `sheetMotion.ts`, `useSheetSwipe.ts`, `motionPrimitiveLiterals.test.ts` and `DESIGN.md`.
  - The literal-guard change only adds the two new primitive files to `PRIMITIVE_FILES`. That makes the guard cover more files; it is not an exemption.
- **AC1, Full motion, live at 375 dark.** I drove a synthetic touch pull on the running app (`start-servers.sh`, ports 7088/9995).
  - Inline `translateY` grows 24 → 87px, which is damped. The phase goes `pulling` → `ready` at 69px.
  - On release the stack holds at 48px in `busy`, then settles to `""`, so no transform remains at rest.
  - Screenshot: `SK/full-ready-375-dark.png`. The follow indicator sits cleanly in the revealed gap with the arrow rotated, and is clipped at the stack top.
- **AC2, fan-out.** I made two qualifying pulls. The network log shows exactly two `GET /api/outputs/<id>/rows` requests (entries 877 and 878), one per pull.
  - There was no pipeline run POST; the only pipeline traffic was the existing GETs and run-events SSE.
  - In code, `registry.start()` calls each registered entry's `refresh()` once. Only panels with `outputId !== null` register (`MobilePanelStack.tsx`). `usePanelData.refresh` keeps its `inFlightRef` guard (`usePanelData.ts:129-131`).
- **AC3, gating.** In code: single-touch only, `scrollTop <= 0` both at start and at engagement, vertical-dominant downward drag after 6px of slop, the nested scroller check, and a form-control exclusion. `preventDefault` is called only after engagement.
  - The evaluator's e2e covers the remaining cases. Its log ends `142 passed`, `pw exit 0`.
- **AC4, overscroll containment.**
  - Live at 375: `.app-content` has `data-pull-refresh` and computed `overscroll-behavior-y: contain`.
  - After resizing to 1280: the attribute is absent, the value is `auto`, there is no `.mobile-panel-pull`, and the desktop `.react-grid-layout` is mounted. This also covers AC7.
- **AC5, Off motion, live** (`data-motion="off"` set only on the client root, so the shared account's preference was not changed).
  - Mid-pull the transform is `""` and the snap pill shows "Release to refresh".
  - Measured: pill y 147–169, chip bottom 141, first card top 155.
  - Screenshots: `SK/off-ready-375-dark.png` and `SK/off-ready-430-light.png`.
  - The pill is legible in both themes. It uses `--app-surface`, `--app-border-strong`, `--app-radius-pill`, `--app-shadow-card` and `--text-xs`, and it is centred and clear of the chips and the title.
  - Under Subtle, Off and reduced motion this compact pill on the first card's top edge is an acceptable, recognisable pattern ("new items" pill). It causes no layout shift.
- **AC6.** Durations come only from `--motion-duration-move` and `--motion-ease-out`. The only literal is the 15s request timeout, which is a network ceiling, not motion.
- **Gates, re-run by me.** `HELIO_JEST_MAX_WORKERS=2 nice -n 19` targeted jest (pull, registry, stack, dragVelocity, literal guard, sheet swipe, hover guard): 15 suites, 108 tests passed. `tsc --noEmit`: OK.
  - The evaluator's persisted full-suite logs are unambiguous: root jest 524/524, frontend 9215/9215, Playwright 142 passed. I accepted them.
- **Console.** The only error was a 502 on `/run-events`, the existing SSE stream, after a viewport resize. That is not from this change.
- **Servers** were stopped with `stop-servers.sh` (`STOPPED ports=7088,9995`).

### Verdict: CONFIRM

### Non-blocking notes
- **Wrong label during the settle.** Under Full, after the busy round ends, the indicator falls back to "Pull to refresh" with the arrow for about 270ms while the stack settles from 48px to 0. This is in the live MutationObserver trace: `busy` at 220ms, `pulling`/`translateY(0px)` at 268ms, removed at 540ms.
  - The clip mostly hides it as the stack rises.
  - A follow-up could keep the busy or "Refreshed" state, or hide the label, during the closing settle.
- **The snap pill is tight:** about 6px clear of the chips and 4px clear of the title. `expectPillClear` guards it, but a header-padding change would trip it.
- **Two copies of the 48px value.** `--pull-indicator-height: 48px` duplicates `PULL_HOLD_PX` in a comment-coupled pair. It could be set inline from the constant instead.
