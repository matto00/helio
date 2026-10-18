## Standing Constraints

- [C1] Every no-horizontal-scroll check (e2e and manual) covers both `document.documentElement` and the `.app-content` scroller (`scrollWidth <= clientWidth` for each).

## 1. Layout

- [x] 1.1 In `frontend/src/features/home/ui/HomePage.css`, remove the shelf's one-column override from the `@media (max-width: 430px)` block so the 2-column 1100px rule applies on phones; keep the opening-sentence rule. Verify: `npm run lint`, `npm run format:check`, `node scripts/check-tokens.mjs` (if present) pass, and no other selector changes.
- [x] 1.2 (not needed: timeline top 563.8 < nav top 732 at 375x800) Only if task 2.1's measurement shows the 375×800 timeline top is not above the bottom nav: tighten the phone shelf gap to `var(--space-3)` within the same 430 block, and record before/after numbers. Verify: the measurement JSON.

- [x] 1.3 Size the shelf skeleton's thumbnail placeholder with the 16/7 aspect ratio (design.md Decision 4) instead of a fixed 96px. Verify: HomePage/DashboardShelf unit tests green, and the e2e (or a screenshot of the loading state) shows skeleton card height within a few px of a loaded card at 375.
- [x] 1.4 Add the one-line DESIGN.md note (design.md Decision 6). Verify: `npm run format:check` passes.

## 2. Pin it

- [x] 2.1 Add `e2e/hel1642-home-phone-timeline.spec.ts` per design.md Decision 5 (375 and 430 × light/dark at height 800: timelineTop < bottom-nav top, 2 rows × 2 cards, no horizontal scroll; plus an unasserted 375×667 measurement). Verify: the spec passes at ≤2 workers under `nice -n 19`, and writes JSON + screenshots to `.concertino/runs/HEL-1642/evidence/`.
- [x] 2.2 Mutation check: temporarily restore `grid-template-columns: minmax(0, 1fr)` for `.home-shelf` at 430 and confirm 2.1 fails on the position assertion; revert. Verify: record the red run output in the executor's handoff.

## 3. Regression

- [x] 3.1 Run the Home unit tests (`npm --prefix frontend test -- --testPathPatterns=features/home`) and the existing `e2e/hel1583-home-375.spec.ts`. Verify: both green.
- [x] 3.2 Screenshot Home at 1280 (desktop) and 820 in light and dark to confirm the shelf there is unchanged (4 and 2 columns). Verify: screenshots persisted under `.concertino/runs/HEL-1642/evidence/`.
