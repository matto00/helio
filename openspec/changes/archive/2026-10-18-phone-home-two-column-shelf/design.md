## Context

See proposal.md (Why). `frontend/src/features/home/ui/HomePage.css` sets the shelf grid to 4 columns, 2 columns at
`max-width: 1100px`, and **1 column at `max-width: 430px`** (the canonical phone breakpoint, DESIGN.md §4). The 430 rule
is the whole cause: HEL-1583's measurement (`.concertino/runs/HEL-1583/evidence/home-375-light.json`) shows shelfTop 206,
four 198px cards, shelf height 841, timeline top 1152.75 at 375×800. Gutters (12px) are already correct. The phone
bottom nav (`BottomNav.css`) floats over the content at the bottom of the viewport, so "visible in the first viewport"
practically means "above the nav's top edge".

## Goals / Non-Goals

**Goals:** timeline top above the bottom nav's top edge at 375×800 and 430×800, both themes, with four dashboards; no
horizontal page scroll; an e2e that pins it; desktop/tablet layouts byte-for-byte unchanged in behaviour.

**Non-Goals:** reordering Home's sections; a horizontally scrolling shelf; changing the number of shelf cards; the
timeline's own phone rows (HEL-1641 item 3); anything outside Home.

## Decisions

1. **Two-column shelf on phones (chosen), self-approved under the ticket's "owner call if it's not obvious".**
   Remove the shelf's one-column override from the `max-width: 430px` block, so the 2-column rule from the 1100px
   block applies down to the smallest phone. Rationale: it is the existing tablet arrangement (no new pattern), keeps
   all four cards visible and tappable without hidden overflow, keeps the page order DESIGN.md §"Home page" describes,
   and is the smallest change. Estimated at 375: card width ≈ (351 − 16)/2 ≈ 167px, thumbnail (16/7) ≈ 63px, card ≈
   120px, two rows ≈ 256px → timeline top ≈ 560–600px, well inside 800 and above the nav.
   - *Alternative: horizontal scrolling shelf row* (like HEL-1583's chips). Rejected: hides cards 3–4 behind a scroll
     gesture, adds a second horizontal scroller on the page, and chips are a navigation switcher idiom, not a content
     shelf.
   - *Alternative: timeline first on phones.* Rejected: changes the page's reading order between breakpoints
     (DOM order vs visual order hazard for screen readers if done with `order`, or a DOM fork), and still leaves a
     ~840px shelf below.
2. **Shelf gap on phones.** Keep `--space-4` (16px) unless the measurement fails; if the 375×800 timeline top is not
   above the nav with margin, the executor MAY tighten the phone shelf gap to `--space-3` (12px, the phone gutter
   token) and record the measurement. No new tokens, no raw px (DESIGN.md §3).
3. **Card foot at ~167px.** The name already ellipsizes (`.home-card__name`); the time and changed dot are `flex: none`.
   This is acceptable: the full name stays in the link's accessible name (the text node is untruncated in the DOM).
   No foot restructuring. The evaluator/skeptic must check the cards visually at 375 in both themes (a name truncated
   to 1–2 characters would be a defect; record what a realistic name like "HEL-1583 Support" shows).
4. **Skeleton.** The loading skeleton uses the same `.home-shelf` class, so its columns follow automatically. Its
   thumbnail placeholder is a fixed `height="96px"` `Skeleton` (`DashboardShelf.tsx`) while a real thumbnail at ~167px
   wide is ~63px (16/7), so the timeline would jump ~66px on load (design-gate note 1; pre-existing at other widths
   too). Size the placeholder with the same 16/7 aspect ratio as `.home-thumb` (e.g. wrap or style it with
   `aspect-ratio: 16 / 7` via a Home CSS class, tokens only) so skeleton and loaded cards match at every width.
5. **e2e.** New `e2e/hel1642-home-phone-timeline.spec.ts`, modelled on `e2e/hel1583-home-375.spec.ts` (same seeding:
   four dashboards, one pipeline with seeded runs via `seedPipelineRuns`). For 375 and 430 (height 800) × light/dark it
   measures, after `document.fonts.ready`, the timeline's `getBoundingClientRect().top` (scrollTop of `.app-content`
   must be 0) and the bottom nav's top edge, and asserts: timelineTop < navTop; four `.home-shelf__item`s in exactly
   two distinct row tops with two cards each; `documentElement.scrollWidth <= clientWidth` AND the `.app-content` scroller's `scrollWidth <= clientWidth` (constraint C1). It writes the measurements
   JSON and viewport screenshots to `evidencePath("HEL-1642", ...)`. It additionally records (no assertion) a 375×667
   measurement as information for a short phone. A mutation check (restore the one-column rule) must make it fail.

## Risks / Trade-offs

- [Long dashboard names truncate harder at ~167px] → accepted, accessible name intact; checked visually (Decision 3).
- [Short phones (667px tall) may still put the timeline under the nav] → measured and reported, not asserted; the
  ticket's bound is the 800px harness HEL-1583 used. A follow-up can be filed if the owner wants a 667 bound.
- [The HEL-1583 measurement spec `e2e/hel1583-home-375.spec.ts` keeps running and asserts only gutters] → unaffected;
  its numbers will simply improve.

6. **DESIGN.md.** Add one sentence to the Home page entry: on phones (≤430) the shelf stays two columns so the
   timeline starts in the first viewport (HEL-1642).
