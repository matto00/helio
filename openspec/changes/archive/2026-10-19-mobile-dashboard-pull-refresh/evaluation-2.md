## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed head: `3b884545b2d52aa8a5a14ede9d99af0c20b6a4b2`, which sits on merge commit `c54f1d5f2` (origin/main `d622886da` merged in). The review covers the delta since `84135b06a`; the merged main content is not under review.
Evidence (persisted): `/home/matt/Development/helio/.concertino/runs/HEL-1656/evidence/.concertino/scratch/HEL-1656/eval/c2/`, called `EV/` below.

### Gates (fresh, final head)
| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` / `format:check` / `typecheck` | exit 0 / 0 / 0 | `EV/lint.log`, `EV/format.log`, `EV/tc.log` |
| `HELIO_JEST_MAX_WORKERS=2 npm test` (root 524 tests; frontend 741 suites / 9215 tests) | exit 0 | `EV/jest.log` |
| `npm --prefix frontend run build` | exit 0 | `EV/build.log` |
| Playwright: hel1656 + hel1583/1584/1646/1668, 2 workers, fresh servers | 142/142 passed | `EV/pw.log` |

### Phase 1: Spec Review — FAIL
AC1 and AC5 regress under Subtle, Off and OS reduced motion; see Phase 3. While a pull is held, the indicator is effectively invisible, so the snap pill no longer "snaps between states" in any way the user can see. Everything else is unchanged from cycle 1 and still PASS.

### Phase 2: Code Review — PASS
All three cycle-1 change requests are resolved:
1. `usePullToRefresh` takes `enabled`. `MobilePanelStack.tsx` passes `useIsPhoneShell()`. `PHONE_BREAKPOINT` and the `useIsNarrowerThan` import are gone, and the gate test was retargeted to `enabled`.
2. `PullRefreshIndicator` no longer has an inline style. There is a single CSS declaration, and its comment ties it to `PULL_HOLD_PX`.
3. The e2e is hardened:
   - `cardPoint` waits for the card to be visible and polls for its bounding box;
   - the upward-drag test asserts the page is scrollable (`scrollHeight - clientHeight > 100`) and yields one frame per move.

   The full set was green on this head. I did not re-run the spec with `--repeat-each`.

### Phase 3: UI Review — FAIL
The orchestrator's call: the snap pill sits in the gap above the first card. Checked with touch emulation at 375 and 430, light and dark, Off (plus Subtle at 375 light). Geometry is in `EV/pweval.log`.
- Title overlap is fixed. The pill spans y 135–163; the first card's title starts at y 173.
- There is no layout shift and no transform: the stack's `transform` stays `none` while held and while busy.
- **Defect: while the pull is held (`pulling`/`ready`), the pill is clipped to an 8px sliver.**
  - The text and icon are not visible: `EV/shots/held-375-light-off.png`, `held-430-dark-off.png`, `held-375-light-subtle.png`.
  - Cause: `.mobile-panel-pull[data-pull-active] { clip-path: inset(0 -100vmax -100vmax -100vmax) }` (`MobilePanelStack.css:198-200`) clips at the wrapper's top edge. The pill now sits at `bottom: calc(100% - var(--space-2))` (`:245`), so 20 of its 28px are above that edge.
  - Under Off and Subtle the hook's `release()` calls `clearMotion()`, which removes `data-pull-active`. That is why the busy pill is fully visible (`EV/shots/busy-430-dark-off.png`), but the pulling/ready feedback is lost.
  - The e2e only asserts `data-state`, so it cannot see this.
- **Secondary: when unclipped (busy), the pill overlaps the chip row.** The chip row spans y 103–147 and the pill y 135–163, so the pill covers the bottom edge of the chips (`busy-430-dark-off.png`). The pill is `z-index: 1`. Whether this is acceptable is a [judgment] call for the skeptic; the clipping above is objective.

hel1584 `morphs the series` (desktop 1440) passed in this run. In cycle 1 it failed only under load in the 142-test set. It also passed on base runs and when co-run with hel1656, and no code in the diff is on its path. It is attributed to the known timing flake (HEL-1651), not to this change.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/panels/ui/grid/MobilePanelStack.css:198-200`: scope the clip to Full motion only, so the snap pill is never clipped. For example, have the hook set `data-pull-active` only when `follows()` is true, or add `data-pull-follow` and select `.mobile-panel-pull[data-pull-active][data-pull-follow]`. The Full-motion indicator still needs the clip (cycle-1 rationale). Then confirm visually at 375 and 430, light and dark, under Off and Subtle, that "Pull to refresh" and "Release to refresh" are readable while held.
2. `e2e/hel1656-pull-to-refresh.spec.ts`, in the Motion off/subtle test: add an assertion that would have caught this. With the pull held, read the pill's rect and the wrapper's computed `clip-path`, and assert the pill is fully inside the visible region: either the wrapper has `clip-path: none`, or `pill.top >= wrapper.top`. Asserting `toBeVisible()` alone is not enough, because clip-path does not affect Playwright visibility. Record the red run against the current CSS.

### Non-blocking Suggestions
- If the skeptic judges the busy pill's overlap with the chip row (about 12px) to be a problem, reduce it by placing the pill at `bottom: 100%` with a smaller vertical padding, or by centring it in the gap between the chip row and the card.
