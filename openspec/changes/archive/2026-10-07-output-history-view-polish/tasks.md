## Standing Constraints

- [C1] Table-height verification is done in the running app at three sizes — 2 rows, ~20–150 rows (non-virtualised overflow), and >150 rows (virtualised) — recording the measured `.output-history__table` and `.ui-data-grid` heights for each; the >150-row case must show a bounded (<=360px) scroll container and render the final rows when scrolled to the bottom.
- [C2] The History button hover's visibility is accepted only on a measured rendered contrast ratio (hovered button pixel vs hovered card pixel, both themes, transitions settled) >= 1.10, the HEL-866 guard threshold; stylesheet values alone are not evidence.

## 1. Ghost button

- [x] 1.1 Set `.output-gallery-card__history` to `border-radius: var(--app-radius-sm)` and `font-weight: var(--weight-medium)`, keep hover `--app-surface-raised` with a comment naming the backdrop (`--app-surface-soft`, the hovered card), the measured ratios and the 1.10 threshold (design D1); extend `OutputHistoryModal.css.test.ts` to assert radius-sm, weight-medium and the `--app-surface-raised` hover ; `font-weight` must be declared AFTER the rule's `font: inherit` shorthand (or replace it), and the guard must assert that ordering (verify: the guard fails if any of the three is reverted or the weight precedes `font: inherit`; running app reads `getComputedStyle(btn).fontWeight === "500"`)

## 2. Capture-time label disambiguation

- [x] 2.1 Add `formatCapturePair` (design D2) to `frontend/src/features/panels/history/formatCaptureTime.ts` with unit tests covering different-minute, same-minute, same-second (ms) and identical-instant cases (verify: `npm test -- --testPathPatterns=formatCaptureTime`)
- [x] 2.2 Route `HistorySummary` (header, "vs" caption, metric baseline), `HistoryChart` (overlay label) and `HistoryRows` (comparison notes) through `formatCapturePair`; leave `HistoryScrubber` and `chartOverlay.ts` output unchanged (verify: existing `OutputHistoryModal.test.tsx` passes)
- [x] 2.3 RTL tests in `OutputHistoryModal.test.tsx`, asserting relationships not exact localized strings: a same-second pair renders header and "vs" label with different text, each containing its millisecond digits; an identical-instant pair renders a "vs" label ending "(older capture)" (verify: tests fail when `formatCapturePair` is reverted to minute/second precision)

## 3. "No row changes" note and table height

- [x] 3.1 In `HistoryRows`, show "No row changes vs <comparison label>" when both payloads are loaded and the diff has no changed and no removed rows (design D3); RTL test for identical payloads showing the note, and asserting it is absent when the comparison payload is missing (verify: test fails if the branch is removed)
- [x] 3.2 Change `.output-history__table` to `max-height: 360px` (design D4), adjusting only `.output-history__table` descendant rules if needed; extend the CSS guard test (verify: guard test, plus the running-app three-size check per [C1], heights recorded)

## 4. Verification

- [x] 4.1 Run frontend gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm test` for the touched suites (verify: all green)
- [x] 4.2 Compare against the running app in light and dark themes: History button rest/hover with the rendered hover contrast ratio per [C2] recorded for each theme, short-table note placement, long-table and virtualised-table scroll per [C1], same-second labels; save screenshots inside the worktree (lane-private browser profile, not the shared Playwright MCP) and list them in the commit/handoff (verify: screenshots exist for both themes)
