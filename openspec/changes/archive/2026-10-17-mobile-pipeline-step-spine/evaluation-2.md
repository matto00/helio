## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `a866b1bdd2b66d23e81838db12c55d9e1680f810`. The base was resolved live as
`29cb0a60f41e72b0a6b26c15a28360c504fffdb8`. The cycle-2 delta is `8d1d12f33..a866b1bdd`.

Live measurements are persisted at
`/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval2/evaluator-cycle2-measurements.json`.
The probe scripts are in `.concertino/scratch/HEL-1582/eval2/`. The live checks ran in my own headless Chromium
(375×812, isMobile, hasTouch). The shared MCP browser was being driven by another lane at the same time: it showed
`:7016` and then jumped to `about:blank` under me.

### Gates (fresh)

| Gate | Result |
|---|---|
| lint, format:check, typecheck, frontend build | exit 0 |
| jest (2 workers) | root 524/524; frontend 704 suites / 8868 tests (was 8861) |
| check:tokens, check:e2e-types, check:openspec | exit 0 |
| Playwright under the lock, 2 workers: the whole `hel1582-mobile-pipeline` file, `hel1628-source-sample-label` and `state-surface-contrast-guard` | **35 passed** (3.1 min). The executor had not re-run these after its final edit; they are green now. |

The servers on `:7014` and `:9921` were reused. I confirmed both processes run from this worktree before trusting them.

### Cycle-1 change requests

1. **CR1 (no flash on close): RESOLVED, verified live frame by frame.** I recorded every rAF frame of the sheet's
   exit for Close, Escape and a CDP touch swipe, each under Full and under Subtle (motion set through
   `PATCH /api/users/me/preferences`). In all 6 cases there are **0 frames** where the dialog is open and at rest.
   - Full: the last open frame holds `translateY(796px)`, and the next frame is closed.
   - Subtle: opacity goes 0.0066 → 0.0013 → 0, and the next frame is closed.
   - Swipe under Subtle: the sheet holds `translateY(400px)` and opacity 0 until it closes.
   - After each close, the inline transform and `data-sheet-exiting` are gone.
   - Reopening leaves the sheet at rest with transform `none` and opacity 1, so C7 still holds.

   The jest harness test samples the dialog at the native `close()` call and in the consumer callback, which is a
   real guard.
2. **CR2 (focus after Move): RESOLVED.** I tested keyboard only, in dark and light: focus the trigger, Enter, Enter on
   "Move step down", then the same again for "Move step up".
   - Focus stays on "Step actions for Filter rows" inside the sheet both times.
   - The row order changes and then restores.
   - The desktop path is unchanged: it still focuses the moved row when no `restoreFocus` is passed.
   - New jest and e2e tests cover it.
3. **CR3 (contrast exemption): RESOLVED.**
   - The exemption is now exactly light + hover + Run pill.
   - That pair is pinned to a floor of 3.9 or above, and `toHaveLength(1)` makes sure the exemption cannot quietly
     cover more.
   - Every other state and theme of the pill is held to 4.5.
   - The misleading comment is gone.
   - The spec now names the exception (follow-up FU-3).
4. **CR4 (ActionsMenu guard): RESOLVED.** `ActionsMenu.test.tsx` asserts the panel's DOM ancestry both inside and
   outside an open dialog, so reverting the portal target would fail it. The new e2e also checks with
   `elementFromPoint` that the in-sheet menu item is not hidden behind the modal.
5. **CR5 (back link): the token and expander change is RESOLVED, but measuring it live found a touch-floor defect.**
   See the new CR1 below.

The cheap items are done:
- seeding now fails loudly when the server rejects a step kind;
- the misnamed variable in the AC2 swipe test is now `stepConfigPatches`;
- the `MobilePreviewTab` import order is fixed and its `!` is replaced;
- there is a desktop test for `recordCreateError`;
- `a[href]` was dropped from the painted-box list, so the back link is now bisected.

### Phase 1: Spec Review — FAIL

AC1–AC3 still hold; the cycle-1 geometry is unchanged. **AC4 ("All interactive elements meet the 44px touch floor")
fails for the back link on a pipeline that has never run**, which is every newly created pipeline. See CR1.

### Phase 2: Code Review — FAIL

The fixes are clean and the tests carry the right intent. One defect is open (CR1). There is one stale comment
(suggestion below).

### Phase 3: UI Review — FAIL

Measured live with `elementFromPoint` bisection at 0.25px on a never-run pipeline (no status label in the header's
status line):

| Width | Back link painted | Back link hit | Note |
|---|---|---|---|
| 375 | 32×32 at y 66–98 | X 44.25, **Y 40** | below y≈99 a tap lands on the `BUTTON.spine-header__chip` expander |
| 390 | 32×32 | **Y 40** | same |
| 768 | 32×32 | **Y 40** | same |

At 375 the "Add schedule" chip is painted at y 108–136 and its own hit is 44. The "Pipeline actions" trigger hits
44.75×44.75.

### Overall: FAIL

### Change Requests

1. **The back link's hit area is 40px tall on a never-run pipeline**: the schedule chip's tap expander covers its bottom
   edge. Files: `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css`, the `.mobile-header__back` rules and
   the status-line chip expander (`.mobile-header__status .spine-header__chip::after`).
   - **When it happens.** With no run yet, `SpineRunStatus` and `SpineLastRunMeta` render nothing. The "Add schedule"
     chip then starts the status line at x=12, directly under the back link.
   - **The overlap.** The painted gap is 10px: back link y 66–98, chip y 108–136. That is below the DESIGN.md §3
     "Expander tiling" [mechanical] minimum of the two overhangs combined (6 + 8 = 14px). The chip's later-painted
     `::after` (z-index 1) therefore takes taps from y≈99, and the back link's vertical hit bisects to 40px at 375,
     390 and 768.
   - **Why the e2e misses it.** The cycle-1 header (a 44px painted back link) had the same overlap. The e2e seed always
     runs the pipeline (`e2e/hel1582-mobile-pipeline.spec.ts:127`), so a status label always sits under the back link
     and the never-run state is never measured.
   - **Fix.** Separate the two by at least the combined overhang under the touch gate (only on the never-run layout or
     always), without inflating either painted box. For example, give the status line enough top spacing under
     `@media (max-width: 768px), (pointer: coarse)`. Keep the header within the D2 budget, then re-check AC1 fit.
   - **Test.** Add an e2e touch-floor sweep of the header on a **never-run** pipeline (seed without the `/run` POST)
     at 375, 390 and 768, using `bisectHitExtent`. It must go red on the current CSS.

### Non-blocking Suggestions

- `frontend/src/shared/motion/BottomSheet.tsx:66`: the comment says "see the layout effect below", but the clearing
  hook is a passive `useEffect` placed above `exit` (lines ~52-57). Fix the wording.
- The cycle-1 suggestions about the Dry run hover delta against its rest fill (light 1.025) and the 501-line
  `PipelineMobile.css` still stand.

### Critical Path

This is cycle 2 of 3. The only blocker is CR1 (back link vs schedule-chip expander on a never-run pipeline). The fix is
one CSS spacing change under the touch gate, plus an e2e sweep that seeds a pipeline without running it. Everything
else from cycle 1 is verified fixed, including live, frame-by-frame proof of no exit flash for Close, Escape and swipe
under Full and Subtle.
