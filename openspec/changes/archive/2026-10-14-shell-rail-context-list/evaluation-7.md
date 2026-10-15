## Evaluation Report — Cycle 7, HEL-1604 fold-in (evaluation-7.md)

Reviewed HEAD `170b9222b84f9fdf254be15418b32aad0d0293a9` (diff `d319238fc..170b9222b`). Freshly fetched origin/main is still `c5cc7eeee`, and V134 is still free.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c7/`

### Gates

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7235/7235 |
| `hel1574-shell-rail.spec.ts --repeat-each=3` (local) | PASS: 51/51 |
| Full Playwright (local, 2 workers) | PASS: 295 |
| **CI on this exact HEAD (`170b9222b`, run 38643580308)** | **FAIL: job `e2e (1)` and therefore `ci-complete`.** `hel1574-shell-rail.spec.ts:339:9` "row Delete confirm opens below its row: double-click, … at 375px" failed. After the double-click the URL was still `/sources` (so the HEL-1604 guard did its job), but `getByRole('group', { name: 'Confirm delete HEL-1574 Long 17' })` was "element(s) not found". Excerpt: `ci-38643580308-e2e1-failure.txt`. |

### Phase 1: Spec Review — FAIL

skeptic-final-3 CR1, carried forward through cycles 5–6, requires that opening the confirm never moves the row under the pointer, and that a double-click on a row's Delete leaves a pending confirm naming that row. CI shows the second half failing at HEAD. The cause is below.

### Phase 2: Code Review — FAIL (root cause found; the HEL-1604 guard alone is not enough)

- **The HEL-1604 guard is correct as far as it goes.**
  - `handleRowClick` now ignores clicks inside the actions cell and clicks with `event.detail > 1`.
  - Sources' actions `<td>` gained the class the guard keys on.
  - The unit tests (plain click opens, actions-cell click and `detail: 2` click do not) are meaningful.
- **The `:150` diagnosis is right.**
  - The old test called `waitForResponse` after the click and after `toHaveCount(0)`. `useContextListLayout.setCollapsed` dispatches the PATCH synchronously on click, so a fast response could arrive before the wait was registered and the wait would then time out.
  - Registering the wait before the click, as now done at :150 and in the keyboard-resize test at :108, is the standard fix.
- **The defect still open: the confirm's `focusOnMount` scrolls the page and moves the clicked row under the pointer.**
  - `shared/chrome/rowDeleteFocus.ts:6-8` calls `element?.focus()` without `preventScroll`.
  - When the clicked row is near the bottom of the scroll area, the confirm row below it is off-screen. `focus()` then scrolls `.app-content` to reveal the confirm, and the row moves up under the pointer.
  - The second click of a double-click therefore lands below the button. Before this cycle that was the row cell, which navigated (HEL-1604). Now it is the inserted confirm row, whose Cancel sits at the right edge, in the Delete column's x-range at every width I measured. That click closes the confirm, which is exactly CI's failure: URL unchanged, no confirm group.
  - The guard removes one consequence (navigation) but not the movement itself, which skeptic-final-3 CR1 forbade.

  Measured live at 375×700 (dark), `/sources`, with the row's Delete placed near the bottom (button y 600.5–625.5) and a real Playwright double-click:

  | Measure | Before | After |
  | --- | --- | --- |
  | `.app-content` `scrollTop` | 158 | 177 |
  | Button y | 600.5–625.5 | 581.5–606.5 |

  - The row moved 19px under the pointer. Evidence: `sources-375-row-shift-after-dblclick.png`.
  - In this run the second click still caught the button's 44px expander. On a longer shift it does not: CI's run hit the confirm instead.
  - At 820 with the list at 400, a single click on the last pipeline row moved it 10px (`scrollTop` 219 → 229).
  - The test passes locally only when the shift happens to stay inside the expander. It is flaky by position and timing, and the guard does not cover it.
- **Red-then-green claim for the new 820 test.** I did not re-run it against the guard-less code, because that needs a second frontend build of reverted code. The mechanism above explains the original red: the second click landed on a row cell. The test does not cover the Cancel landing.

### Phase 3: UI Review — FAIL (the above, observed live)

These still hold:
- A single click on a non-link cell opens the item on both pages. Clicking the Status cell on Pipelines opened `/pipelines/<id>`; clicking the Kind cell on Sources opened `/sources/<id>`.
- A click in the actions cell's gap between Share and Delete does not navigate, and neither does a `detail: 2` click.
- At 820 with the list at 400, a double-click on the last row stays on the page and opens one confirm for that row (in this position).
- From earlier cycles: Cancel returns focus to the row's Delete, the confirm stays inside the scroller, and the 44px expander and button recipe are unchanged.

### Overall: FAIL

### Change Requests
1. **Do not let opening the confirm scroll the clicked row.**
   - In `frontend/src/shared/chrome/rowDeleteFocus.ts`, change `focusOnMount` to `element?.focus({ preventScroll: true })`.
   - If the confirm must be revealed when it opens off-screen, do it without moving the row during the double-click window. Two options:
     - Defer it with `setTimeout(..., 500)` and then `element.scrollIntoView({ block: "nearest" })`.
     - Reveal it only for keyboard-initiated opens.
   - Either way, the clicked row's `getBoundingClientRect().top` must not change during a double-click.
2. **Make the regression deterministic.**
   - In `hel1574-shell-rail.spec.ts`, add a case at 375×700 (and one at 820 with the list at 400) that positions the clicked row's Delete so its confirm row would open below the viewport, for example `scrollTop` set so the button's bottom is about 75px above the viewport bottom.
   - Double-click it, then assert:
     - the URL is unchanged;
     - exactly one confirm, naming that row, is visible;
     - the row's top moved less than 2px.
   - This should be red today and green after CR1.

### Critical Path
- CR1 is a one-line change in `rowDeleteFocus.ts`, plus an optional deferred reveal, plus the deterministic test in CR2. It is the only blocker.
- CI is red on this HEAD, so the PR cannot merge as is.
- Recommendation for the human: approve one more scoped fix-forward for CR1 and CR2. The HEL-1604 guard and the `:150` test fix in this cycle are correct and should be kept.

### Non-blocking Suggestions
- The `detail > 1` guard also ignores a genuine second click on a row cell. That is harmless, because the first click has already navigated.
