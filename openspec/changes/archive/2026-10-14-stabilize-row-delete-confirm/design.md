## Context

The overview-row Delete (HEL-1574) lives in `PipelineListTable.tsx` / `SourceListTable.tsx` (the row button calls
`noteDeleteActivation(event.detail)` then `onRequestDelete`), and the pages (`PipelinesPage.tsx`, `SourcesPage.tsx`)
render the confirm as `rowExtra`: a full-width `<tr>` inserted after the clicked row, whose sticky, width-bounded
`role="group"` content takes `ref={focusOnMount}`. `rowDeleteFocus.ts` holds a module flag set by
`noteDeleteActivation`; `focusOnMount` focuses with `preventScroll` and calls `scrollIntoView({block:"nearest"})` only
after a keyboard activation (`detail === 0`). The vertical scroller is `main.app-content` (`App.css:288`); at <=768 it
has `padding-bottom: var(--bottom-nav-height)` (`App.css:498`) and the BottomNav is `position: fixed` over it
(`BottomNav.css`). The table scrollers (`SourceListTable.css:93`, `PipelineListTable.css:27`) set only
`overflow-x: auto`, which COMPUTES `overflow-y: auto` too, but they never overflow vertically (design-gate probe:
`scrollHeight === clientHeight`). React is 19 under `<StrictMode>` (`main.tsx:66`) and the e2e runs the dev server, so
a ref callback runs attach, `null`, attach on mount; on a switch A -> B one commit calls A's `ref(null)` before B's
`ref(el)`. A second click of the same Delete sets the same state and commits nothing. Cells call `formatRelativeTime(iso)`
(`utils/formatRelativeTime.ts`), which reads `Date.now()` on every render.

Defects (HEL-1574 evaluation-8): fresh-row relabel on re-render shifts rows 126-153px between presses; keyboard
reveal under the BottomNav at 375; no pointer reveal.

**The invariant this change enforces:** wherever the page can scroll enough to compensate, the activated Delete
button does not move on screen between the two presses of a double-click (every cell except I19); nothing scrolls
until the double-click window has passed; then the confirm is revealed fully inside the visible area (above the
BottomNav at phone widths). Where the page cannot compensate (I19, D2's limit) the weaker guarantee holds: no press of
the gesture deletes, cancels or navigates (D2b).

## Goals / Non-Goals

Goals: the three defects, the 375 `fixme` re-enabled, every matrix cell green. Non-goals: owner-ruled behaviour,
other `formatRelativeTime`/`ConfirmInline` callers, the squeezed 375 Sources table (HEL-1582).

## Decisions

**D1 Labels change only on a shared tick.** New `frontend/src/hooks/useNow.ts`: `useNow(intervalMs)` via
`useSyncExternalStore`, one module-level ticker per interval. Snapshot lifecycle: `getSnapshot` returns the stored
value; when no ticker is running and the stored value is older than the interval (or unset) it first refreshes it to
`Date.now()`, so a table mounting after idle never ages rows against a stale `now`; `subscribe` 0 -> 1 starts the
interval, last unsubscribe stops it. Repeated `getSnapshot` calls return the same value between ticks. A test-only
reset export clears module state between jest tests. `formatRelativeTime(iso, now = Date.now())` gains an optional
`now` (other callers unchanged). Both tables call `useNow(60_000)` once and pass it to every cell, so a re-render
(opening a confirm) cannot change a label, row height or column width. Accepted: labels emit seconds, so a fresh row
can read "5 seconds ago" for up to a minute; and the minute tick is a new periodic reflow at narrow widths (it
replaces per-render churn, which was more frequent). `hooks/useRelativeTime.ts` is not reused: it is a per-instance
10s ticker with its own compact formatter ("5s ago"), and the tables need one shared `now` for many cells.
`hooks/README.md` lists `useNow`. Rejected: `nowrap` + min-width time cells (changes the crushed 375 layout, needs a
per-font measured min-width, column widths still move).

**D2 Pin the activated button across the opening commit (pointer only).** `noteDeleteActivation(detail, button)`
records the activation: mode (pointer when `detail >= 1`, else keyboard) and the pin record. Pin-record lifetime,
one rule: EVERY activation overwrites it (a keyboard activation sets it to none); it is consumed by the first
`focusOnMount(el)` after it; and a record its own activation's commit did not consume is discarded on the next
animation frame (React commits a click's update synchronously, so a frame later means "no commit used it", e.g. the
second click of a double-click). A later remount (StrictMode re-attach, a 409 row, anything) therefore never applies a
stale record. The pointer pin record: the button, its `getBoundingClientRect().top` and its vertical scroller = the
nearest ancestor whose computed `overflow-y` is `auto|scroll` AND `scrollHeight > clientHeight` (this skips the table
scrollers, see Context), else `document.scrollingElement`. On consumption, if the button is still connected,
`delta = top_now - top_recorded` and when `|delta| >= 0.5` the scroller's `scrollTop += delta`. Covers label reflow and
a switch that closes a confirm above the clicked row (delta negative, cell I8), and any residual scroll-anchoring
adjustment (the pin measures the final post-layout position, so it composes with anchoring instead of double-correcting).
**Limit:** scrolling cannot go below 0 or past the end, so when the page cannot scroll far enough (near the top, or a
page that does not scroll, e.g. 1280 with a short list) a switch still moves B up by up to the closed confirm's
height, and the second press may land in B's own new confirm row. D2b makes that press harmless.
Guard: jsdom computes no overflow, so only the e2e top-delta assertions (I2, I8, I14) prove the scroller choice.
Not covered (residual): a `useNow` tick landing between two presses re-renders without remounting, so no pin runs; the
window is ~0.5s per minute and needs a label that changes length and wraps. Recorded, not engineered around.

**D2b The second press of a gesture can never confirm or cancel.** `ConfirmInline` gains an opt-in
`ignoreRepeatClicks` prop; when set, its Confirm and Cancel handlers return early on `event.detail > 1` (the HEL-1604
pattern). `PipelinesPage` and `SourcesPage` set it on the row-Delete confirm; the other 9 `ConfirmInline` callers are
unchanged. Keyboard activation (`detail 0`) and a deliberate single click (`detail 1`) still work, so this changes
nothing for a real Confirm. With D2b, the worst outcome of any residual shift is a confirm opening for the row under the
second press, never a delete or a navigation.

**D3 Deferred pointer reveal; arming survives React's ref order.** `REVEAL_DELAY_MS = 500` (Chromium/Windows default
double-click time; GTK 400). Module state: `mounted` (the attached confirm element or null), `timer`, last mode.
- `focusOnMount(el)`: `mounted = el`; focus with `preventScroll`; apply the pin (D2); then if the last activation was
  keyboard, `scrollIntoView({ block: "nearest" })` now, else (re)arm the timer for `el`.
- `focusOnMount(null)`: clear `timer` and `mounted`; keep the last mode, so the StrictMode re-attach and the switch's
  `ref(elB)` re-arm.
- `noteDeleteActivation`: keyboard clears any pending timer (the mount reveals). Pointer with a confirm already
  mounted re-arms the timer for `mounted` (the second click commits nothing, so this is what pushes the reveal to
  500ms after the last press). On a switch it re-arms for A, then A's `ref(null)` clears it and B's `ref(el)` arms B.
- While armed, a user `wheel` or `touchstart` cancels the pending reveal (the user is already scrolling; the reveal must
  not pull the page back): one passive, capture-phase listener pair on `window`, added when the timer is armed and
  removed whenever the timer fires or is cleared (so at most one pair exists).
- The timer fires `scrollIntoView({ block: "nearest" })` on `mounted` only if it is still the armed element and
  connected; it never scrolls a detached element.
Residual: an OS double-click time above 500ms can see the reveal between two slow clicks.

**D4 Reveals clear the BottomNav.** In `App.css`'s existing `@media (max-width: 768px)` block, `.app-content` gets
`scroll-padding-bottom: var(--bottom-nav-height)` beside its `padding-bottom`, using the same token so the two cannot
drift. `scrollIntoView` honours scroll-padding, so both D3 and the keyboard reveal stop at the nav's top edge. Side
effect, intended: any focus-scroll inside `.app-content` at phone widths now also clears the nav. 768 is the phone
shell (HEL-1574 ruling), so it gets the rule too; 769+ has no nav and no padding.

**D5 Call sites stay minimal** (HEL-1579 edits `PipelineListTable` concurrently): per table, one `useNow` line, the
`now` argument on each `formatRelativeTime` call and `noteDeleteActivation(event.detail, event.currentTarget)`. No CSS
change in either table file.

## Regression matrix (each cell tested at 375, 768, 820 with the list at 400, and 1280; light and dark)

Expected in every cell unless noted. Fresh = rows created < 60s earlier ("just now"/"N seconds ago" visible).
`E2E` = asserted by a Playwright case (CI), `LIVE` = evaluator/skeptic browser probe with recorded measurements.

| # | Interaction | Expected | Cover |
|---|---|---|---|
| I1 | Pointer single click, mid row | Confirm row directly below; nothing scrolls; button top delta < 2px | LIVE |
| I2 | Pointer double-click, fresh rows, row bottom 75px above viewport edge, both pages | Both presses on that Delete; top delta < 2px; one confirm naming the row; URL unchanged | E2E 375 + 820/400; LIVE 768, 1280 |
| I3 | Same, settled labels | As I2 | E2E 1280 (existing) |
| I4 | Pointer single click on the last visible row (confirm opens below the fold) | No movement at 300ms; by 1s the confirm is fully visible, bottom <= BottomNav top (<=768) or viewport bottom | E2E 375; LIVE others |
| I5 | Pointer double-click on that last visible row | As I2 during the gesture, then as I4 | LIVE |
| I6 | Keyboard Enter on a Delete near the bottom | Immediate reveal, bottom <= BottomNav top (<=768); focus on the group | E2E 375; LIVE others |
| I7 | Table scrolled sideways to its end, then I2 and I6 | Confirm content visible (sticky); no horizontal jump; I2/I6 expectations hold | E2E 820/400 (existing, gains top delta); LIVE 375 |
| I8 | Confirm open under row A, page first scrolled down by at least A's confirm height; double-click Delete on row B below A | Both presses on B; only B's confirm; B's top delta < 2px | E2E 375; LIVE others |
| I9 | Cancel / Confirm / refused (409) | Focus back on the row's Delete / the neighbour's Delete / the row's Delete; 409 notice below the row | E2E existing; LIVE |
| I10 | Row click outside the actions cell; a near-miss in the actions cell; second click | Navigates / does not / does not (HEL-1604) | unit + E2E existing |
| I11 | Delete the last row of a long list at scroll bottom | Scroll position kept | E2E existing |
| I12 | Minute tick | Labels update on the tick, not on re-render | unit (fake timers) |
| I14 | I8 with A's confirm scrolled above the viewport (anchoring + pin) | B's top delta < 2px, both presses on B | E2E 375; LIVE 820/400 |
| I15 | After I8, B's confirm below the fold | Revealed after the window, above the nav at <=768 | E2E 375 |
| I16 | Click A, then within 500ms click Delete on B | Only B's confirm revealed; A's timer never scrolls a detached node | unit; LIVE |
| I17 | 820/400, page at max scroll, table at its end, double-click the LAST row (HEL-1574 skeptic-final-5 CR1), both pages | I2 during the gesture, then I4; URL unchanged | E2E 820/400; LIVE |
| I18 | Other phone `scrollIntoView` callers now honour the padding (assistant panel `block:"end"`) | Still readable, latest message above the nav | LIVE 375 |
| I19 | Switch A -> B, page unable to compensate: /pipelines 375, page at top, table at its end, A's long-name confirm open | Press 2 recorded ON a Confirm/Cancel button (asserted: the cell is not vacuous); no DELETE request; no navigation; one confirm open; B's top delta recorded | E2E 375 (see classification) |
| I20 | Pointer double-click on A, Cancel, scroll 300px, Enter on B's Delete | No 300px jump (stale pin discarded); B revealed | unit; LIVE |
| I21 | Wheel/touch scroll during the 500ms window | Pending reveal cancelled | unit; LIVE |
| I13 | Button recipe and expander | Secondary at rest, danger on hover, 44px expander at <=768, both themes | LIVE |

## Tests (red first)

- Un-`fixme` the 375 variant at `e2e/hel1574-shell-rail.spec.ts:387`. For I2, the test asserts the target row's time
  cell matches `/just now|seconds? ago/` immediately before the `dblclick` (proof the rows are fresh), removes the
  `settledRowTop` wait between placement and the gesture, and restores the < 2px top-delta assertion (measured before
  and after the gesture); the HEL-1604 820/375 test gains the same freshness check and delta.
- New cases: I4 + I6 at 375 asserting confirm `bottom <= .bottom-nav top + 1` (I4 via `expect.poll`, plus a 300ms
  no-movement check); I8 + I14 + I15 at 375; I17 at 820/400 on both pages.
- Red-or-guard classification (run each on base `cd64409ad`, fix stashed, 3 runs; record outputs). Expected red on
  base: I2 at 375 (CI 38665737092, evaluation-8 2/2), I4, I6 (eval-8 measured under the nav), I15, I17's reveal half.
  Guards (may pass on base; each must be shown failing against its named mutation of the FIXED code): I2 at 820/400
  (base 1/2) and its top delta -> M1 per-render `Date.now()` in the tables; I8, I14 top delta (scroll anchoring may
  absorb on base) -> M2 no-op pin; I17's double-click half (HEL-1604 already fixed) -> M0 remove the `detail > 1` row
  guard; I19 -> M5 drop `ignoreRepeatClicks` (the press-2-on-a-confirm-button assertion makes M5 delete, so red).
  I19's geometry: the executor tunes it (A's name length, `dblclick({ position })` within B's Delete) until press 2
  lands on Confirm or Cancel, and asserts that via `recordPresses`; if no such geometry exists at 375 it reports so and
  I19 becomes a unit-level guard on `ConfirmInline` only. Any cell neither red on base nor failed by its mutation is
  vacuous and must be fixed before commit.
- Unit: `rowDeleteFocus.test.ts` is rewritten (its "pointer does not scroll" case contradicts D3). Fake timers:
  pointer arms on mount and fires once; second click re-arms; `null` cancels; keyboard immediate and cancels pending;
  switch order `note(1, btnB)`, `ref(null)`, `ref(elB)` fires on elB only (I16); StrictMode el/null/el fires once; pin
  applies a negative and a positive delta to a stubbed scroller and skips `|delta| < 0.5`. `useNow.test.ts`: shared
  ticker, stable snapshot, mount/unmount/advance 10 min/remount gives a current value, reset between tests.
  `formatRelativeTime` with an explicit `now`. Pin lifetime: the I20 sequence and a remount with no fresh activation
  apply no pin; wheel cancels the reveal. `ConfirmInline`: `ignoreRepeatClicks` ignores `detail > 1` on both buttons,
  default behaviour unchanged.
- E2E freshness check reads the target row's own time cell right before the gesture and seeds as few rows as the
  layout needs, so a slow runner does not age the labels past a minute.

## Risks

- `useSyncExternalStore` snapshot must be stable between ticks (return the stored value, never `Date.now()`).
- The pin reads layout once per pointer activation (one forced layout); negligible.
- D2's limit (above): a residual shift is possible when the page cannot scroll; D2b bounds its outcome to "a confirm
  for the row under the second press", never a delete. `useNow` labels can lag by up to about two intervals after idle.
- `App.css` may also be edited by HEL-1575; the rule is one line in an existing block.

## Planner Notes

Self-approved, local and reversible: the 60s tick and accepted sub-minute staleness (D1); 500ms reveal delay and
reschedule-per-click (D3); D4's page-wide phone scroll-padding. None changes an owner ruling or a surface later epic
tickets build on, so no escalation. The ticket's suggested fixes were treated as claims: D1 and D4 adopt them, D3
changes "cancel" to "reschedule" (cancel-only never reveals after a double-click), and D2 is added for I8.
Length: ~160 lines, over the 150-line authoring rule, because the driver-required regression matrix (21 cells) lives here.
