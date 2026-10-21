## Standing Constraints

- [C1] Tap-target claims are proven by elementFromPoint measurement in the running app, never by CSS-text checks alone; the 44px floor is hard (escalate, never shrink).
- [C2] Never remount .panel-list__zoom-container across the 768px boundary; any provider wrapping it is DOM-less and unconditional.

## 1. Red first

- [x] 1.1 Write `e2e/hel1681-refresh-control.spec.ts` (D9) and run it on the unmodified base; verify it fails for the missing button and save the run output to scratch.

## 2. Refresh control (item 1)

- [x] 2.1 Extend `PullRefreshRegistry` with entry-count subscription and round source (D2); verify with new jest tests plus a recorded red mutation.
- [x] 2.2 Add the DOM-less provider wrapping `PanelList`'s whole subtree unconditionally, with the stack's fallback instance and dispose ownership per D1; verify `MobilePanelStack.pullRefresh.test.tsx` and `pullRefreshRegistry.test.ts` stay green, and add the 768px-crossing check (same `.panel-list__zoom-container` node, non-zero width).
- [x] 2.3 Add the "Refresh dashboard" button to the refreshed line (D3) and restrict the pull indicator to pull-started rounds (D4); verify jest render/busy/aria tests and the 1.1 spec turns green.
- [x] 2.4 Measure the real tap area with `elementFromPoint` at 375 and 430 against the expander's actual box per D3 (44x44 inside `.panel-list`'s rect, four corners + centre hit the button, 1px below misses it, the first chip keeps its own taps) and confirm the stack's resting top is unchanged vs base; record numbers in scratch (escalate if 44px cannot fit).

## 3. Indicator tidy-ups (items 3, 4)

- [x] 3.1 Add the D6 CSS/JS guard test and update the CSS comment; verify it passes and a recorded mutation turns it red.
- [x] 3.2 Add the post-refresh "Refreshed" settle state (D5); verify a jest test and a Full-motion probe that never samples "Pull to refresh" during the settle (before/after numbers recorded).

## 4. Collapsed chart card (item 2)

- [x] 4.1 Reproduce on base under Full motion at 375 with recorded hit rate, and confirm the root cause with a probe (D7); verify with saved probe output.
- [x] 4.2 Fix at the root cause with a regression check and before/after rates, or, if not reproducible within budget, record the measurement path per D7.

## 5. Flake triage (item 5)

- [x] 5.1 Triage `hel1575-dashboard-tabs.spec.ts:593` per D8; verify by recorded repeat-run output and a written triage note (fix included only if small and test-only).

## 6. Docs and verification

- [x] 6.1 Update DESIGN.md §10/§12 (D10); verify the text names the button and the settle state.
- [x] 6.2 Screenshots at 375 and 430 with touch emulation, light and dark, under Full, Subtle and Off motion, plus 1280 desktop (unchanged) into `/home/matt/Development/helio/.concertino/scratch/HEL-1681/`.
- [x] 6.3 Run lint, typecheck, format:check, frontend jest (`HELIO_JEST_MAX_WORKERS=2`), `hel1656-pull-to-refresh.spec.ts` and the new spec; verify all green.
