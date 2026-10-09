## Standing Constraints

- [C1] The style-guard regex must not match a selector preceded by a comma (the shared annotation/note selector list); test that negative case.
- [C2] The narrow container-query width threshold must stay below phone-stack card widths so the 96px floor never lands in the mobile stack (HEL-1438 scope); state the threshold with the stack measurement.
- [C3] Owner ruling 2026-10-09 (accept-scoping-file-followup): the 96px canvas minimum applies to w=2,h=4 cards WITHOUT a viewer-control bar; the control-bar case must stay contained (no overlap) and its layout goes to a follow-up.

## 1. Reproduce and measure (red-first)

- [x] 1.1 On the running app (worktree dev servers, throwaway user), build a >200-row chart Output with an annotation at w=2, h=4 (lg) and record card/header/footnote/canvas heights in light and dark; verify by persisting the measurement as evidence
- [x] 1.2 Write the e2e spec (design D4) asserting canvas >= 96px with both footnotes visible in both themes; verify it FAILS on the unfixed code and save the failing output as evidence
- [x] 1.3 Measure the mobile stack (phone viewport) chart canvas for the same panel pre-fix; record the number as evidence

## 2. Fix the narrow layout

- [x] 2.1 Add `chartTruncationNoteShortText` with unit tests for "rows" and "matching rows" forms and digit grouping; verify the unit tests pass
- [x] 2.2 Render long + short spans in `ChartRenderer` (full sentence kept in DOM/AT and title; short shown only under the narrow container query) and add the narrow container-query CSS (1-line clamp, 96px canvas floor); verify with a renderer unit test that both texts are present and the long one is not aria-hidden
- [x] 2.3 Re-run the e2e spec; verify it passes in light and dark, and re-measure the mobile stack (report before/after only)

## 3. Comment and style guard

- [x] 3.1 Update the `truncationNote` prop comment in `ChartRenderer.tsx` to describe the two-line clamp and the narrow short form; verify by reading the diff
- [x] 3.2 Make the style-guard regex comment-robust (design D6) and add an in-test fixture case proving the old regex misses a rule after a comment while the new one catches it; verify the new case fails with the old regex and passes with the new

## 4. Live wording check

- [x] 4.1 Live check the "matching rows" wording under a viewer filter (and server cross-filter if reachable) in light and dark; verify by persisting both screenshots as evidence

## 5. Gates

- [x] 5.1 Run `npm run lint`, `npm run typecheck`, `npm run format:check`, and the full `npm test`; verify all pass, including HEL-1392's panel-data reuse tests
