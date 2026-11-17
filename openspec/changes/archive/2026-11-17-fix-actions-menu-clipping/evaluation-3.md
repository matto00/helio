## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed commit: 2784dd32253ae4ab9e6004d21305c26d8324f989 (squash 054f50ace + archive dae1fe919 + test fix 2784dd322; base 2e98eba92).
Scope: the cycle-3 change (e2e only), plus the CI failure it responds to (run 44185332093, shard 6).

### Root cause of the CI failure — found and probe-confirmed: a real product defect, not a test race

The CI failure is caused by a real, pre-existing product defect in the dashboard rail (the reported surface), not by a test-only race. The cycle-3 test change works around it without fixing it.

**What the CI trace showed**

I downloaded the trace from run 44185332093 and analysed it:
- During the 80 s hover retry loop, 239 of 428 screencast frames differ in content.
- The frames alternate between two states (for example md5 `618e311c` and `bb717f7c` recur).
- The whole page moves, not just the list: the icon rail and the "No panels yet" block shift together by about 20px at screencast scale.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval3-frame1.jpeg`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval3-frame3.jpeg`
- The hovered row flips between Row 01 and Row 02.
- The network log has no polling: 2 `dashboard-changes` calls and 2 `GET /api/dashboards` in total. So the movement is not data-driven re-sorting or `motion-enter` re-entry.

**The mechanism**

I probed it live on 7182 at 1280x400 with 12 dashboards.
1. The ⋮ wrapper `.popover.actions-menu` in every rail row is visually hidden at rest by `DashboardList.css:254`: `position: absolute; width/height 1px; clip`.
2. Its containing block is `.context-list` (`offsetParent`). The scroll container `.dashboard-list` is `position: static`.
3. So the hidden wrappers of rows scrolled out of the list are **not clipped by the list's scroller**. They extend the document's scrollable overflow.
   - Measured: `document.scrollHeight` = 538 at a 400px viewport. The deepest box is `popover actions-menu`, absolute, bottom 538.
   - The page therefore has a phantom vertical scroll of about 138px.
4. Hovering (or focusing) a row applies the reveal rule (`position: relative`) to that row's wrapper. The document height then changes from 538 to 504.
5. With the page scrolled to its end, `scrollY` clamps from 138 to 104 and every row jumps 34px under a stationary pointer. A different row is then hovered, the height changes again, and the loop repeats.

**Reproduced locally, with the exact CI log signature**

Steps: list scrolled to its end, window scrolled to max, then hover the last row. Playwright reports:
- "Row 02 … `<li … motion-enter>` subtree intercepts pointer events"
- then repeated "element is not stable"
- and `scrollY` ends at 104 (from 138).

**The fix is confirmed by a probe**

Setting `position: relative` on `.dashboard-list` (inline, in the browser only; no code changed) gives:
- `document.scrollHeight` 538 → **400**, so the phantom page scroll disappears entirely;
- every wrapper's `offsetParent` becomes the list.

**Ownership**

- The rule dates from HEL-235/HEL-1003 (`affbec86e`), and the HEL-1750 diff does not touch it. It is pre-existing on `main`.
- It is exactly the class of problem the ticket's third AC names: "Every other ⋮ / ActionsMenu inside a clipping container (rail, …) is checked for the same problem. Any found are fixed or listed."
- It is not listed in the archived artifacts or the call-site audit.
- A real user sees it too: on a short window, pointing at the bottom rail rows makes the page jump by about 34px.

### Phase 1: Spec Review — FAIL

1. AC3 is not met for the defect above: an ActionsMenu inside the rail's clipping container inflates the page scroll, and it is neither fixed nor listed.
2. The cycle-3 test comment (`e2e/hel1750-actions-menu-viewport-fit.spec.ts`, the block above `trigger.focus()`) blames "the list's own scrolling". That is not the cause. The planning record is wrong about the mechanism.

### Phase 2: Code Review — FAIL

Gates on the changed file:
- `npm run lint`, `format:check`, `check:e2e-types`, `check:e2e-user-cleanup` and `check:e2e-evidence-paths`: all clean.
- The e2e with `--repeat-each=3`: 6 of 6 pass.
- No frontend source changed this cycle, so jest and the build are as in cycle 2.

**Question 2: does keyboard open still satisfy the AC and C13?**
- AC "every item can be clicked": the last item is still checked by an inside-viewport plus `elementFromPoint` hit test. It is then clicked with a real pointer (`getByRole("menuitem", { name: "Delete" }).click()`; the panel is portalled and `position: fixed`, so the rail defect does not affect it).
- Opening with focus + Enter is a legitimate user path, and the ticket does not require a pointer open.
- C13: the new "no finite animation on `.dashboard-list`" poll is a real readiness signal, not a skeleton selector.
- So on AC and C13 alone, the keyboard open would be acceptable.

**Question 1: is it masking a product defect?**
- Yes. Once the root cause is known, the switch away from the pointer is a workaround for a product defect, not a fix for a test race.
- Keyboard focus triggers the same `:focus-within` height change. The test simply has no stationary pointer to feed the loop.
- So the e2e now passes on a page that still jumps.
- Under the "fixture change is a symptom" rule, the test change should not ship as the fix.

### Phase 3: UI Review — FAIL

Probed live at 1280x400 (dark), with numbers above. The rail at short heights shows a phantom document scroll (538 vs 400) and a hover-driven page jump of about 34px. Menu placement itself (the HEL-1750 fix) is unaffected and still passes, as in cycles 1 and 2.

Dev-DB residue: my eval user `af2c7c52-1bd2-4cd7-b25f-a356a3929b48` (12 dashboards) was deleted by exact id via `buildUserDeleteSql`. `/api/auth/me` now returns 401.

### Overall: FAIL

### Change Requests
1. **Fix the root cause in the product.**
   - Make the rail's scroll container the containing block for the visually-hidden wrappers: add `position: relative` to `.dashboard-list` in `frontend/src/features/dashboards/ui/DashboardList.css`, or the equivalent on the element that is the list's `overflow` scroller.
   - Probe-confirmed: `document.scrollHeight` goes from 538 to 400 at 1280x400.
   - Check that it does not disturb the sticky heading or folder groups. `SidebarItemList` also uses `.dashboard-list`, which is harmless.
   - Record it in the archived `design.md` (a short D10: "hidden ⋮ wrappers escaped the non-positioned scroller") and in the AC3 audit.
   - If the orchestrator decides this belongs in its own ticket, the minimum is to **list** it with the evidence above as the AC3 follow-up and file the ticket. The test must then still not hide it (see CR3).
2. **Restore the pointer path for opening the menu in the desktop e2e, once CR1 lands.** Hover the last row and click its trigger, as a user does, and keep the animation-settle wait. The pointer open is what caught the defect, and it is the owner's reported path.
3. **Add a guard for the defect that is red first.** In the desktop case, after the row is hovered, assert `document.documentElement.scrollHeight <= window.innerHeight`, or that `scrollY` is unchanged across hover. Show it red against the current `DashboardList.css` and green after CR1. Replace the incorrect "raced the list's own scrolling" comment with the real mechanism.
4. **Re-run the reds.** The existing desktop and phone menu reds against the unfixed `ActionsMenu.tsx` must still be red after CR1/CR2.

### Critical Path (final cycle, EXECUTION_CYCLES = 3)
- The HEL-1750 menu fix itself is sound and passed cycles 1 and 2. The only blocker is that the CI failure exposed a real, pre-existing rail defect in AC3's scope, and the cycle-3 change hides it.
- Recommendation for the human: either
  - (a) accept a small cycle-4 fix: CR1 (one CSS declaration), CR2 and CR3; or
  - (b) rule that the rail page-scroll defect becomes its own ticket. In that case list it (AC3 "or listed"), keep the keyboard open with a corrected comment naming the real cause, and merge.

  Shipping the current test with its incorrect explanation is not recommended either way.
