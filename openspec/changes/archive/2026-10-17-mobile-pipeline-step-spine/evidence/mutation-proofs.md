# HEL-1582 mutation proofs: every new guard can go red

Each guard was broken on purpose, observed red for the stated reason, then restored (clean tree, green again).

## Jest

| Guard | Mutation | Red |
|---|---|---|
| `BottomSheet.test.tsx` "no transform at rest" | `settleSheet` leaves `translateY(0px)` inline instead of removing it | 3 failed: short drag leaves no transform; pointercancel spring-back; veto spring-back |
| `BottomSheet.test.tsx` veto | `onRequestClose`'s `false` ignored | 1 failed: "springs back when the consumer vetoes the close" |
| `BottomSheet.test.tsx` "never starts a drag from the body" | `.ui-modal__body` added to the drag surfaces | 1 failed |
| `BottomSheet.test.tsx` "holds the dialog open through its exit" | exit finishes at once under Full | 2 failed (hold-open, second-request-ignored) |
| `motionPrimitiveLiterals.test.ts` (sheet files added to `PRIMITIVE_FILES`) | planted literal in each timing shape: the guard's own "fails on a planted literal" case | existing, covers the new files |
| `PipelineMobile.css.test.ts` expanders | `z-index: 1` removed from the touch block's `::after` | 5 failed (`.mobile-btn`, `.mobile-pill`, the schedule chip, the source name button, the ghost button) |
| `PipelineMobile.css.test.ts` painted floors | `.mobile-tabs__tab` height 44px -> 36px | 1 failed ("full-width list controls are painted at their floor") |
| `PipelineSpine.test.tsx` "a refused reorder ... never steals focus" | (real defect) the retired river's pending-focus clearing was missing from `useSpineStepActions` | failed before the fix, green after |

## Live (`e2e/hel1582-mobile-pipeline.spec.ts`, each test carries its mutation)

| Guard | Injected mutation | Red |
|---|---|---|
| AC1 fit | `.spine-row__select { min-height: 150px }` | `assertFits` rejects (a row ends below the bar's top) |
| AC3 clearance | `.mobile-body { padding-bottom: 0 }` | the last item sits under the pills; `assertClear` rejects. Also re-asserted with the draft slot filled (taller bar) |
| AC4 touch floor, painted | `.mobile-tabs__tab { height: 30px }` | `bisectHitExtent` rejects |
| AC4 touch floor, expander | `.mobile-pill::after { display: none }` | `bisectHitExtent` rejects |
| Contrast | `.mobile-tabs__tab:hover { background: transparent }` | the measurement returns `fail` ("nothing changed") for hover |
| Swipe (no mutation needed) | short slow drag, a body drag and a long drag in one test | the short drag is asserted to follow the finger (`translateY(2x-4x px)`) and the body drag to leave no inline transform mid-gesture, so a dead gesture cannot pass vacuously |

`e2e/hel520-focus-presence-guard.regression.spec.ts` Case B was ported off the deleted river header: with an injected
`.spine-section { overflow: hidden }` the focus-presence probe reports `clipped on X by ancestor box`, and reverts to `pass`
(`HEL520_REGRESSION=1`, regression config). Case A (a login input) fails in this harness independently of this change
(the mutated verdict reads `pass`); that page is untouched here.

## Cycle 2 (evaluation-1.md) red to green

| CR | Mutation (the old behaviour restored) | Result |
|---|---|---|
| CR1 sheet flash on close | `BottomSheet.tsx`: clear the exit trace in `finish` before `closed()` (the cycle-1 code) | 3 tests red: "holds the dialog open through its exit slide", and "never paints the closing sheet at rest" for Full and Subtle (an open dialog sampled with no exit trace at the consumer callback and at native `close()`). Green with the trace cleared by a passive effect after `Modal` closes |
| CR2 focus after Move in the sheet | `MobileStepSheet.tsx`: do not pass `focusSheetActionsTrigger` | `PipelineMobileLayout.test.tsx` "keeps focus inside the sheet ... after Move down" red (focus on the row behind the modal); live e2e asserts the active element is the in-sheet trigger |
| CR3 Run-pill contrast | exemption narrowed to light + hover; floor 3.9 pinned | every other pill state/theme is held at 4.5; a drop below 3.9 fails `KNOWN_ACCENT_HOVER_FLOOR` |
| CR4 ActionsMenu in a dialog | `ActionsMenu.tsx`: `setPortalTarget(document.body)` | "portals the panel into the open dialog" red; e2e opens the in-sheet menu, checks the item is not occluded and is inside the dialog, and activates Move step down |
| CR5 back link | n/a (structural) | `PipelineMobile.css.test.ts` asserts the control-token size plus the centred 44px expander; the live touch sweep measures the back link by `elementFromPoint` bisection (no longer treated as a painted box) |
| recordCreateError, desktop | `usePipelineStepCreation.ts`: drop the `recordCreateError` call | "a failed create on the desktop spine shows the inline error" red |

## Cycle 3 (evaluation-2.md) red to green

| Defect | Red (current CSS before the fix) | Green |
|---|---|---|
| Back link 40px tall on a never-run pipeline (the schedule chip's expander overlapped its bottom edge) | New e2e "AC4: the header of a never-run pipeline (and in rename mode) clears the 44px touch floor" fails at 375x812, 390x844 and 768x1024: `never-run header: "Back to pipelines" y: bisected y-axis hit extent must clear the epsilon-adjusted floor (>= 43.75)` | `.mobile-header__status { margin-top: var(--space-1) }` under the touch gate (header gap 4px + 4px = the chip's 8px overhang, the back link's own 6px slack is inside the row). All three pass |
| Rename field painted 32px (found by the same header sweep in rename mode with Save / Cancel) | `rename header: "Pipeline name" painted height 32` at all three sizes | `.mobile-header .mobile-header__name-input { min-height: 44px }` under the touch gate; the row is already 44px so nothing else moves |

Header sweep states covered live: never-run, and rename with the dirty Save / Cancel row. Other adjacent pairs checked by geometry: the name row to the Save / Cancel row (both expanders stay inside their own 44px rows), the Save / Cancel row to the status line (same 4px + 4px), and the status line to the tabs (the chip's lower overhang ends exactly at the header's 8px bottom padding). The Discard / Keep editing confirmation uses the same `.mobile-btn` boxes in the same row.

## Cycle 4 (evaluation-3.md) red to green

| Defect | Red on 00dfd8df2 | Green |
|---|---|---|
| Status line wraps to a third line after an in-session Run (the persisted "12,345 rows written · 3 hours ago" beside "Snapshot replaced: N rows"), Output card 2px under the action bar | New e2e "AC1: the Output card still clears the action bar at 375x812 while a Run is queued and after it succeeds" (pipeline GET patched to a run 3 hours ago with 12,345 rows): `output ends above the action bar`, received 698 against a bar top of 696; status line 60px tall | `MobilePipelineHeader` renders `SpineLastRunMeta` only when no in-session status (`sseData.status ?? runStatus`) shows. Status line 28px in the queued and succeeded states, Output card fits in both |

## Cycle 5 (evaluation-4.md) red to green

| Defect | Red on beb35975a | Green |
|---|---|---|
| A truncated last run with an 8-digit count (12,345,678 rows, Partial badge) and a paused cron chip wraps the status line to three lines on page open, Output card 8.8px under the action bar | New e2e "AC1: a truncated last run with an 8-digit row count and a paused cron chip still fits at 375x812 on page open, with the Partial badge visible": `output ends above the action bar`, received 704.8 against 696.5 | The run status and the meta share one nowrap line (`.mobile-header__runline`) that ellipsizes; the badge is `flex: none`. Status line 50.8px, Output card bottom 688.8 (7.2px above the bar), Partial badge visible |

## Final gate, skeptic round 1 (skeptic-final-1.md) red to green

| Defect | Red on 9fbe26a7a | Green |
|---|---|---|
| Sheet tap targets stolen by the AND/OR (and other segmented) expanders; short checkbox labels under 44 wide | `sweepFloor` now bisects both axes for every control (C8: selects, inputs, labels included) over every step kind's editor in the open sheet at 375, 390 and 768 (a union step with a second source was added to the seed). Red at all three sizes: `Filter rows: "Field for condition 1" y`, `Select fields: checkbox label x`, `Union / append rows: "Other source" y`, `Split text: "Content field to split" y` (the last was not in the skeptic's list) | `.mobile-step-sheet__content .pipeline-detail-page__filter-combinator { margin-block: var(--space-3) }` (the 10px overhang plus clearance) and `label:has(> checkbox/radio) { min-width: 44px }` under the touch gate. All three sizes pass |
| The visually hidden headings escape the scroller; scrollIntoView scrolls the page 247px and loses the header | New e2e "a long step list never lets the page scroll away its header": page scrollHeight 1557 against clientHeight 688 | `.mobile-body { position: relative }`. scrollHeight equals clientHeight, and scrollIntoView on the hidden heading leaves the header where it was and the page scrollTop at 0 |

## Final gate, skeptic round 2 (skeptic-final-2.md) red to green

| Defect | Red on 4d2d6316a | Green |
|---|---|---|
| (a) The Analyze with AI "Move output field N up" button cannot be tapped: its painted centre resolves to the neighbouring "down" button, and the tap reorders a,b,c,d wrongly | New e2e "AC4 (C8): tapping the Analyze with AI \\"Move output field 2 up\\" ...": Playwright's actionability check refuses the tap (`Move output field 2 down intercepts pointer events`); a raw touch at the painted centre leaves the order not `b,a,c,d` | The pair is spaced under the touch gate (24px painted, `flex: none`, 12px margin each side, the remove button 4px further out), so each expander owns 44 and nothing overlaps. Tap on field 2 up gives `b,a,c,d`; tap on field 3 down gives `b,a,d,c` |
| (b) The C8 sweep seed skipped eight `OP_TYPES` kinds | The seed now adds join, lookup, upsertsource, extractheadings, chunkbytokencount, convertformat, analyzewithai (4 output fields, so the middle rows have both moves enabled) and generatetext. The server accepted every one (the seed fails loudly on any rejection, none was rejected). Red at 375, 390 and 768 on the Analyze with AI editor only: `Move output field 1..4 up/down` x-axis hit extent under 43.75 (and "never reached stable, hit-testable geometry" for occluded ones); the seven other new kinds already passed | Sweep green at all three sizes over 26 step editors |

## Final gate, skeptic round 3 (skeptic-final-3.md) red to green

| Defect | Red on f181c9646 | Green |
|---|---|---|
| The "N fields" disclosure trigger is below the touch floor (17.75px on the Preview tab, about 35px in the sheet) | The seed's source gains 14 columns, so the disclosure renders; the Preview-tab sweep and the every-kind sheet sweep fail at 375, 390 and 768: `preview: "18 fields" y`, `sheet Filter rows: "17 fields" y`, and the same on Sort, Compute, Cast, Rename, Date bucket, Dedupe, Fill null, String operation and Window | 44px `::after` under the touch gate plus `padding-block: var(--space-4)` on the header that holds it. Both sweeps green at all three sizes |
| Schema filter field 28px tall (found by the maximal sweep) | `dark/light schema disclosure panel: "" y: bisected y-axis hit extent` | `min-height: 44px` under the touch gate |
| The disclosure panel opens off the right edge at 390 (found by the maximal sweep) | the filter field's centre is not hit-testable (the panel's right edge is at x=626 on a 390px viewport); jest: `keeps the panel inside the viewport when the trigger sits near the right edge` fails | the left position is clamped to the viewport; the jest test and the maximal sweep pass |

The maximal sweep (`evidence/maximal-sweep.md`) found no other misses.

## Final gate, skeptic round 4 (skeptic-final-4.md) red to green

| Defect | Red on 61c4b458b | Green |
|---|---|---|
| The "N fields" panel inside the step sheet renders beneath the modal dialog (it was portalled to `document.body`) | New e2e "the \\"N fields\\" panel opens fully on screen, above the sheet, with a real filter hit area ... at 375x812 / 390x844": `dark step sheet: the panel's centre hit-tests to the panel` expected true, received false (the Preview-tab cell of the same test was already inside the viewport with a 44px filter hit area). Jest: `portals the panel into the open <dialog> its trigger sits in` and `opens below ... when the trigger is near the top` fail | The panel portals into `trigger.closest("dialog[open]") ?? document.body`; it opens below when the room above is smaller than both the panel and the room below, and its height is capped to the room on the chosen side. Both e2e sizes pass in both themes (panel inside the viewport, centre hits the panel, filter hit extent at least 43.75 on both axes) |

Desktop at 1440x900 (new e2e): with the trigger about 320px from the top, less than the panel's 384px above it, the panel now opens below the trigger and stays inside the viewport. Before this change it opened upward and its top edge left the viewport. Where the room above is sufficient, it still opens upward as before.
