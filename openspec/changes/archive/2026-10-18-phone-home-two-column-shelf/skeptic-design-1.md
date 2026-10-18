## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 495bd72196a8558b3c913cdb0ae44be807563cf9 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **The root cause matches the code.** In `frontend/src/features/home/ui/HomePage.css`, the shelf is 4 columns at line 81, 2 columns inside `@media (max-width: 1100px)` (lines 712-715), and 1 column inside `@media (max-width: 430px)` (lines 729-732). That 430 block holds only the shelf override and `.home-opening__sentence`. So removing lines 730-732 changes layout at ≤430px only. Desktop and tablet are untouched, as Goals claims.
- **The size estimate holds up against HEL-1583's measured numbers.** Source: `.concertino/runs/HEL-1583/evidence/home-375-light.json` and `home-430-light.json`.
  - At 375 the measured values are: shelfTop 206, card 198px (thumb 327×7/16 ≈ 143 plus ~55px of padding, gap, foot and border), section gap 24, section-top-to-timeline 82.
  - With 2 columns: card inner ≈ 143px, so thumb ≈ 63px and card ≈ 120px. Two rows plus a 16px gap ≈ 256px. Timeline top ≈ 206 + 256 + 24 + 82 ≈ 568.
  - The nav is `position: fixed` with bottom = inset + safe-area and a fixed capsule height (`BottomNav.css` lines 15-28), so its top sits around y≈730 at 800px tall. That leaves ~160px of margin. At 430 the margin is a little smaller because cards are taller (~135px), which still leaves roughly 130px.
  - Decision 2's gap fallback (`--space-3`) is unlikely to be needed. It is properly conditional and uses tokens only.
- **The e2e would be red on current code.** On main today, timelineTop is 1152.75 (375) and 1249 (430), both far below any nav top under 800. The "2 distinct row tops × 2 cards" assertion is also red with one column (4 distinct row tops). Task 2.2 adds an explicit mutation check that restores the 1-column rule. The selectors exist and are proven by `e2e/hel1583-home-375.spec.ts`: `[aria-label="Pipeline runs, last 24 hours"]`, `.home-shelf__item`, and `.app-content` scrollTop. Seeding reuses `seedPipelineRuns` from `e2e/support/homeSeed.ts`, which exists.
- **The AC bound is faithful to the ticket.** The ticket asks that the timeline top be "within the first viewport". The fixed glass nav covers the bottom ~70px of that viewport, so a top hidden under the nav is not really visible. "Above the nav's top edge" is the stricter of the two readings and matches the intent. 800px height is the harness HEL-1583 used for its measurement, so "first viewport" is the same frame the ticket's numbers came from. Measuring 375×667 without asserting it, and disclosing that, is honest. A 667 bound would be an owner-agreed extension, not part of the AC.
- **The self-approved choice is genuinely obvious; no ESCALATION needed.**
  1. It is the first option the ticket lists.
  2. It reuses a layout Home already ships at 431-1100px, so it adds no new pattern (DESIGN.md §12 asks phone layout to be width-gated, which it stays).
  3. It is a one-rule, trivially reversible CSS deletion.
  4. It meets the AC with large margin.
  5. The two alternatives have concrete costs the design names correctly. A horizontal shelf hides cards 3-4 behind a gesture. "Timeline first" either splits visual order from DOM order or needs a DOM fork, and still leaves an ~840px shelf below it.

  DESIGN.md's Home bullet (lines 1109-1118) fixes content and order but no column count, so nothing binding is contradicted. Opening a rejection loop with the owner over this would cost more than the change does.
- **Scope and coverage.**
  - AC1 (position at 375 and 430) is covered by task 1.1 plus the 2.1 assertion.
  - AC2 (both themes) is covered by the 2.1 theme loop.
  - AC3 (no horizontal scroll) is covered by the 2.1 `scrollWidth <= clientWidth` check, and the spec delta adds 430 to the widths that must not scroll.
  - AC4 (e2e pins it) is covered by 2.1 and 2.2.
  - There is no scope drift: Non-Goals exclude reordering, the timeline's phone rows (HEL-1641) and anything outside Home.
  - There is no API or schema impact, so no contract delta is needed. The `home-page` spec delta is an ADDED requirement, consistent with the base spec's designed-states requirement (`openspec/specs/home-page/spec.md` lines 147-156).
- **No placeholders.** Task 1.1's "check-tokens.mjs (if present)" hedge is harmless because `scripts/check-tokens.mjs` exists. The tasks do not contradict the design.

### Verdict: CONFIRM

### Non-blocking notes

- **The skeleton height will not match the cards.** proposal.md says the skeleton follows the 2-column layout "so loading does not jump". The column count does follow, but the skeleton thumb is a fixed `height="96px"` (`DashboardShelf.tsx`), while a real card thumb at ~167px wide is ~63px tall. Each skeleton row is therefore ~33px taller than the loaded row, so the timeline moves up ~66px when the shelf loads.
  - This mismatch already exists today (96px vs 143px in one column), so it is not a regression and not an AC item.
  - Either soften the proposal's wording, or have the skeleton block use the thumb's 16/7 aspect ratio. Do not let the final gate treat "does not jump" as proven.
- **Name truncation at 375 is real but acceptable.** With "now" in the foot, the name gets ~100-105px at `--text-sm`, so "HEL-1583 Support" will ellipsize to roughly "HEL-1583 Sup…". Decision 3 already sends this to the final-gate visual check.
- **Use the right element for the no-scroll check.** The e2e's horizontal-scroll check should also cover the `.app-content` scroller (scrollWidth vs clientWidth), not only `documentElement`. Overflow inside the app's own scroller would not show up on the document.
- **Optionally record the decision in DESIGN.md §12.** A one-line note in §12 (Mobile), "Home shelf stays two columns on phones (HEL-1642)", would make the decision discoverable to the next phone ticket. It is not required: the spec delta already pins the behaviour.
