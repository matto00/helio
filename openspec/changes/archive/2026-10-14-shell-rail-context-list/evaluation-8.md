## Evaluation Report — Cycle 8, HEL-1604 follow-up (evaluation-8.md)

Reviewed HEAD `24d446d5c0ffb97b0cf8ad3f495d3ee8279fcfcc` (diff `170b9222b..24d446d5c`). Freshly fetched origin/main is still `c5cc7eeee`, and V134 is still free.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/eval-evidence-c8/`

### Gates

| Gate | Result |
| --- | --- |
| `gh pr checks 1016` | All green on this exact head: run 38657145921, headSha `24d446d5c…`, conclusion success. This includes e2e(1)–(4), frontend, backend(0)–(3) and ci-complete. |
| lint, format:check, typecheck, check:e2e-types | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7238/7238 |
| `hel1574-shell-rail.spec.ts --repeat-each=3` (local) | PASS: 54/54 |

### Phase 1: Spec Review — FAIL

The requirement from skeptic-final-3 CR1 and my evaluation-7 is that a double-click on a row's Delete opens the confirm on that row, and that nothing moves under the pointer between the two clicks. That still fails in a reproducible, user-reachable case. The cause is not the code this cycle changed.

### Phase 2: Code Review — FAIL

**This cycle's change is correct as far as it goes.**
- `focusOnMount` now uses `focus({ preventScroll: true })`.
- `noteDeleteActivation(event.detail)` scrolls into view (`block: "nearest"`) only after a keyboard activation (`detail === 0`).
- Unit tests in `rowDeleteFocus.test.ts` cover pointer, double-click and keyboard.
- The HEL-1604 row-click guard and the `:150`/`:108` wait-before-click fixes are intact.

**Judgment on the substituted assertion.** The executor replaced "row top moved less than 2px" with capture-phase mousedown targets.
- Asserting that both presses land on the same row's Delete is the user-facing requirement, so the substitution is legitimate in principle.
- But the unexplained 22–26px native scroll it was introduced to tolerate is the symptom of a real defect. The test avoids that defect only because its `settledRowTop` waits make it rare.

**Root cause (reproduced; full log in `probe-results.txt`).**
- Opening the confirm re-renders the table, which recomputes `formatRelativeTime(…)` for every row (`SourceListTable.tsx:180`, `PipelineListTable.tsx:192,216`).
- At narrow widths the "Updated" column wraps. A label that changes length between renders, such as "just now" → "3 seconds ago" or "59 seconds ago" → "1 minute ago", changes row heights.
- When rows above the clicked one grow, the clicked row moves **down** under the pointer between the two clicks.
- Chrome's scroll anchoring then adjusts `scrollTop`. That adjustment is the "native scroll after both presses" the executor saw.
- Column widths do not change, so this is not caused by the sticky rule, `container-type`, `focus` or `scrollIntoView`.

**Reproduction.** I used a standalone Chromium probe (`scrollprobe-nowait.cjs`): a real `dblclick({ force: true })` on the 16th row's Delete, placed with its bottom 75px above the viewport edge.
- **375×700, `/sources`, fresh rows** (labels "just now" / "2 seconds ago"):
  - The first press hit "Delete P Row 06" and the second hit **"Delete P Row 08"**.
  - The open confirm then named **Row 08**, not the row the user double-clicked.
  - Rows moved +126 to +153px, and `scrollTop` went 404 → 503.
  - Row text before: "… just now" (53px rows). After the first click: "… 3/4 seconds ago" (71px rows).
  - Reproduced on 2 of 2 fresh runs.
- **820×800 with the list at 400, `/sources`, fresh:** same failure, 1 of 2 runs.
- **1280×800, `/pipelines`:** 0 of 2 (labels do not wrap).
- **Settled lists** (all labels "1 minute ago"): 0 of 45 runs across 375 and 820, on both pages.

The user-visible outcome is that the user double-clicks Delete on one item and gets a confirm for a different item. The confirm does name the item, but a destructive control silently retargeting is exactly what CR1 was meant to prevent.

**Red-then-green claim (12/12 pre-fix).** Not reproduced; it needs a build of the reverted code, which is not cheap. The mechanism from evaluation-7 accounts for it, and CI is green post-fix.

### Phase 3: UI Review — FAIL

**1. Wrong-row confirm after a double-click.** As above, at 375 and 820, on lists created within the last minute (or at minute boundaries).

**2. Keyboard reveal hides the confirm behind the phone bottom nav.**
- Test: 375×700, Delete focused near the bottom, Enter.
- `scrollTop` moved 656 → 674 (the reveal fires).
- The confirm group sits at y 638–700, while the floating BottomNav starts at y 632. The confirm is almost entirely covered.
- `scrollIntoView({ block: "nearest" })` measures against the scroll container's full height, which includes the area under the floating nav.
- Evidence: `sources-375-keyboard-confirm-under-bottom-nav.png`.

**3. Pointer activation now opens an invisible confirm.** Pointer activation deliberately no longer reveals the confirm. A row near the bottom therefore opens its confirm fully below the viewport, or behind the nav at 375, and nothing visible happens after the click. Evaluation-7 offered a deferred reveal after the double-click window for exactly this case.

### Overall: FAIL

### Change Requests
1. **Stop relative-time labels from changing on unrelated re-renders**, so opening a confirm cannot reflow rows.
   - Compute "now" once per tick instead of per render, for example a shared `useNow(60_000)` passed into `formatRelativeTime`, in `SourceListTable` and `PipelineListTable`.
   - Alternatively, make the Updated cell's text not affect row height (`white-space: nowrap` with a min-width that fits the longest label).
   - Add an e2e case that double-clicks immediately after seeding (labels "just now") at 375 and at 820 with the list at 400. Assert that both presses target that row's Delete **and** that the row's top moved less than 2px. Restore the 2px assertion once the reflow source is gone.
2. **Reveal the confirm without moving the row during a double-click, and clear the BottomNav.**
   - For pointer activation, reveal it after the double-click interval, for example `setTimeout(() => el.scrollIntoView({ block: "nearest" }), 500)`, and cancel the timer if a second click arrives.
   - For both keyboard and pointer, give `.app-content` a phone-width `scroll-padding-bottom` equal to the BottomNav reserve, so "nearest" lands above the floating nav.
   - Add an assertion that the revealed confirm's bottom is at or above the BottomNav's top at 375.

### Critical Path
- Both items are small and local: one hook or CSS change for the relative-time reflow, plus a deferred reveal and one `scroll-padding-bottom` rule, plus the two e2e assertions.
- CI is green on this head, but the green comes from a test that, through its settling waits, avoids the window where the defect occurs.
- Recommendation for the human: either approve one more scoped fix-forward, or explicitly waive CR1 (the wrong-row confirm on freshly created lists at narrow widths) and CR2 (confirm hidden under the bottom nav or below the fold).

### Verified intact
- The HEL-1604 guard: no navigation from the actions cell or on a second click (`detail > 1`). Unit tests are present.
- The `:150`/`:108` wait-before-click fixes.
- Settled-list double-clicks land on the same row (45/45).
- Focus moves with `preventScroll`.
- Keyboard activation does scroll (it reveals, but under the nav, as noted above).
