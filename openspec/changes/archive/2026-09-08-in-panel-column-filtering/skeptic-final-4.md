## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Cold review of `604a8115` (rebased onto `origin/main` `736a8cbb`). Every conclusion below is
derived from my own measurement in the running app or from the files themselves. The executor's
and evaluator's reports were read as claims to verify, not as facts.

### Port hygiene — confirmed by content, not by port number

`curl http://localhost:5883/src/shared/ui/DataGrid.tsx` returns the branch's own source, containing
`export const FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 247.5;` and
`export const GRID_MIN_USABLE_HEIGHT_PX = 79.5;`. `origin/main` has neither. Every visual
observation below is therefore of THIS branch.

---

## THE PRIORITY: the corrected boundary (247.5 / 79.5), swept live

The executor flagged that nobody had swept the corrected constants. I have now done so, on both
surfaces and in both themes.

### 1. All four threshold terms re-derived from my own measurements

The brief warned that three separate threshold terms in this ticket were derived by assumption and
each was wrong, and told me not to accept the fourth on arithmetic alone. I measured every term
independently in the running app rather than reusing any prior report's figures:

| term | my measured value | source |
| --- | --- | --- |
| filter toolbar | **37px** | `.ui-data-grid__filter-toolbar` rect, dashboard panel |
| quick-filter row | **37px** | `.ui-data-grid__quick-filter-row` rect |
| column-header row | **34.5px** | `thead tr` rect; `getComputedStyle(colTh).top` also reads `34.5px` |
| per-column filter row | **45px** | `.ui-data-grid__filter-row--columns` rect (the row carrying `<input>`s) |
| FULL filtered-empty message | **86px** | `.ui-data-grid__filtered-empty` rect, expanded state |
| COMPACT filtered-empty message | **44px** | same element with `--compact` |

`34.5 + 45 = 79.5` → `GRID_MIN_USABLE_HEIGHT_PX` **confirmed**.
`37 + 37 + 86 + 79.5 = 239.5`, `+ 8` (`--space-2`) `= 247.5` → `FRAME_FILTER_COLLAPSE_THRESHOLD_PX`
**confirmed**. The cycle-5 correction (the per-column row is 45px, not the header's 34.5px reused)
independently reproduces: the two rows genuinely differ by 10.5px.

### 2. The transition at exactly 247.5 — swept, both sides

Swept on the panel detail modal, where viewport height gives single-pixel control of the frame.
The measured frame height is the quantity the constant is compared against, so this is the boundary
itself, not a proxy:

| frame `clientHeight` | chrome state | message form | grid height | modal body scrolls? |
| --- | --- | --- | --- | --- |
| 761 | expanded | full (86) | 601 | no |
| 303 | expanded | full (86) | 143.4 | no |
| 251 | expanded | full (86) | 90.6 | no |
| **248** | **expanded** | full (86) | **87.95** | **no** |
| **247** | **collapsed** | **compact (44)** | 166.1 | **no** |

The transition falls exactly between 247 and 248 — i.e. at 247.5. **At no point in the sweep did
the app choose a state its own chrome could not fit.** At 248, the tightest expanded state the app
will ever choose: the grid gets 87.95px against the 79.5px it needs, the header row and the first
per-column `<input>` (rect 298.0–326.0) sit entirely inside the grid's box (255.0–343.0), and
`.panel-detail-modal__view-body` reports `scrollHeight === clientHeight` (264 === 264) — no scroll.

### 3. The override path pins at the floor, with chrome actually visible

Verified on **both** surfaces, not merely present in the DOM:

- **Dashboard panel**, enforced minimum (frame 143), user clicks Filters: grid rect height is
  **exactly 79.5px**; header row 211–245.5 and the per-column `<input>` 254–282 both fall entirely
  within the grid's 211–290.5 box. This is the state that measured 7px in evaluation-3.
- **Panel detail modal**, frame 171, user overrides: grid again **exactly 79.5px**, 61 per-column
  inputs. The first input's rect initially sat below `.panel-content--table`'s clip, so I checked
  reachability rather than assuming it: `.panel-content--table` reports `scrollHeight 248 /
  clientHeight 187`, i.e. it genuinely scrolls; after `scrollTop = scrollHeight`,
  `document.elementFromPoint` at the input's centre returns **`INPUT.ui-data-grid__filter-input`** —
  visible and hit-testable, not merely in the DOM. That scroll is the consequence D10-11 explicitly
  sanctions on the user-override path.

---

## The specific defect class hunted: rendered geometry and cross-file contracts

### Sticky still engages (D10-7) — a near-miss I had to reproduce before concluding

My first measurement said sticky was **dead**: scrolling `.ui-data-grid` by 500px moved the `thead
tr` rect from 204 to −296. That would have been a REFUTE. Per the evidence discipline I re-ran it
against the correct element before concluding — a `<tr>`'s rect does not follow its `position:
sticky` `<th>` children, so the `<tr>` was the wrong instrument.

Measuring the `th` cells directly, at `scrollTop` 0 / 300 / 1500 on the modal:

- header `th` top: **204, 204, 204** (pinned at the grid's own top)
- per-column filter `th` top: **238.5, 238.5, 238.5** (= 204 + 34.5, exactly the measured offset)

Same on the dashboard panel at `scrollTop` 1200: header `th` pinned at 211, per-column `th` at
245.5. `.ui-data-grid` is `overflow: auto`, is the scrollport, and does scroll vertically
(`scrollHeight` 7034 vs `clientHeight` 106). **Sticky is live on both surfaces; the machinery is
consumed, not inert.** Confirmed visually in `sk4-02` and `sk4-04`.

I also probed the seam between the two sticky rows for bleed-through (the fractional 34.5px offset
is a plausible sub-pixel gap): gap is **exactly 0**, both rows compute to the same opaque
`rgb(22,21,20)`, and `elementFromPoint` at 0.25px steps across the seam band returns `TH` at every
sample. A faint artifact visible in a downscaled CSS-pixel screenshot is absent at device scale.

### The zero-match explanation renders in BOTH expansion states

The ticket's core value. Verified live, both states, both themes:

- **Collapsed (app-chosen, after reload so the user-toggle ref is unset)** — `.ui-data-grid__
  filtered-empty--compact`, text "No rows match your filter." with the full text preserved in
  `title`, inline "Clear filters" action, badge reads **"Filters (1)"**. Fully above the fold
  (rect 174–218 against a fold at 288). Screenshot `sk4-06` (light).
- **Expanded** — `.ui-data-grid__filtered-empty`, unclamped, 86px. Screenshot `sk4-05` (light).

A filter matching nothing never renders as a confident wrong answer in either state.

### Guards measure what they claim — run against the known-bad state

Not accepted on assertion. I mutated the source and ran the suite:

- **Against the known-bad `GRID_MIN_USABLE_HEIGHT_PX = 69` / `FRAME_FILTER_COLLAPSE_THRESHOLD_PX =
  151`**: both guards go **RED** — the arithmetic guard (`151 >= 229` fails) and the CSS floor guard
  (`/min-height:\s*69px/` vs the CSS's `79.5px`). The executor's claim reproduces exactly.
- The `:970` relabelling is **honest**. Its title now reads "STRUCTURAL CHECK (not a layout guard --
  see the CSS floor guard above for the real invariant)" and its comment states plainly that DOM
  presence was never the failing property (61 inputs inside a 7px grid). It no longer claims to
  guard shell survival, and it points at the guard that does. That is the correct disposition of a
  test that measured the wrong property — kept for the narrower property it does prove, relabelled
  rather than deleted.
- Worktree restored to clean (`git status --porcelain` empty) after every mutation.

### Invariants D10-10 1–7

1. **Persistence** — `updateOutput(outputId, { config: { columnFilters: filters } })`
   (`TableRenderer.tsx:157`): minimal patch, never spreads `output.config`. `canWrite` pre-check at
   `:338`. Unmount cleanup (`:287-301`) `clearTimeout`s then **calls** `persistColumnFilters` from a
   ref — a flush, not a cancel. Round-trip verified live: filters persisted, survived reload
   (badge `Filters (1)` after a fresh load), and cleared back to `Filters`.
2. **Predicate** — `tableFilterPredicate.ts:13` calls the exported `formatCell`, the same function
   `DataGrid.tsx:764` renders cells with. Match source and rendered text cannot drift.
3. **Supersession** — `showLoadedScopeNote = rowsTruncated || filtering` (`:389`). Live in the
   modal with a matching filter (200 → 87 rows): **exactly one** `.panel-content__disclosure`,
   reading "87 results."
4. **Removal seam** — one `LoadedScopeDisclosure` import and one call site.
5. **HEL-448 modal re-gate** — wired (`rowsTruncated` threaded through `PanelDetailModal`); the
   filter/disclosure path demonstrably reaches `TableRenderer` in the modal (item 3). The sort
   qualifier itself did not render on the Output I had, correctly, because `rowsTruncated` is false
   there (200 rows, `hasMore` false) — no reachable truncated Output on this dev DB to exercise the
   positive case. Stated as a coverage limit, not as a pass.
6. **`Filters (n)` badge** — reads "Filters (1)" whenever a filter is active, in the collapsed state,
   both themes.
7. **Drag-resize** — `table-layout: fixed` retained; the resize handle (`role="separator"`) takes
   focus and ArrowRight widens the column **160 → 170px** (the 10px `KEYBOARD_RESIZE_STEP`).

### D10-5 success criterion

`stickyCellMaxWidth` does not exist (only a historical comment naming it); no `colSpan` anywhere in
`DataGrid.tsx`'s JSX; no inline `maxWidth` computed. The reframe was actually done.

### Gates — re-run by me, not taken from the report

```
Test Suites: 293 passed, 293 total
Tests:       3045 passed, 3045 total
lint (eslint --max-warnings=0): clean
typecheck (tsc --noEmit): clean
```
Run as `npm --prefix frontend test`, not the root `npm test` (which is
`jest --passWithNoTests && npm --prefix frontend test` and would silently pass on zero root tests).

### UI / design judgment

Against `DESIGN.md`. The reframed chrome reads as native Helio, not as a bolted-on one-off: the
toolbar carries `--app-surface-soft` with `--app-border-subtle` and `--space-*` padding (the same
recipe as the `<th>` rules it replaced, re-expressed in tokens rather than re-derived values); the
filter inputs reuse the app's standard field styling; spacing rhythm and typographic hierarchy match
sibling screens. **Light/dark parity holds** — compare `sk4-06` (light) with `sk4-07` (dark): same
structure, tokens resolving per theme, no hardcoded values leaking through. Focus routes through
`outline: var(--app-focus-ring)` — `grep -n focus DataGrid.css` shows only the two
`:focus-visible` rules, both using the token, no bordered focus state (HEL-1046 picked up by the
rebase, no code change needed). **Zero console errors** on this branch's surfaces.

---

### Verdict: CONFIRM

The corrected boundary holds under my own measurement on both surfaces and in both themes, the
constants re-derive from terms I measured myself, the app never chooses an unfittable state across
the sweep, the override path pins at the floor with genuinely visible and hit-testable chrome, the
zero-match explanation renders in both expansion states, sticky engages, and the load-bearing guard
is mutation-failable against the exact known-bad state it claims to exclude. This ships.

### Non-blocking notes

1. **A stale derivation figure survives in `files-modified.md`** (cycle-3 section, item 3): the
   collapsed-default floor is stated as "toolbar (37) + header row (34.5) + compact message (~44)
   ≈ 115.5px, comfortably under 159px, with ~43.5px of margin." With cycle 5's corrected 79.5px grid
   floor that sum is `37 + 44 + 79.5 = 160.5px`, which **exceeds** the 159px available at the
   enforced minimum panel height. I measured the consequence: on the app-chosen collapsed path,
   `.panel-content--table` reports `scrollHeight 169 / clientHeight 159` — a 10px scroll.
   **This is not the halting defect class and not a regression**: the frame itself fits (bottom 280
   vs fold 288), all frame chrome and the header row are above the fold, and the only thing
   overflowing is the empty `<tbody>`'s `min-height` padding — i.e. the CSS floor doing exactly its
   job. But this ticket's most persistent failure mode is precisely a confidently-false derivation
   comment left in place after the numbers moved, and this one is in the delivery artifact. Worth a
   one-line correction. **Editorial.**
2. **The guards cannot catch a coherent-but-wrong measurement.** I mutated to the exact state cycle 4
   shipped — `GRID_MIN_USABLE_HEIGHT_PX = 69`, `FRAME_FILTER_COLLAPSE_THRESHOLD_PX = 237`, CSS
   `min-height: 69px` in sync — and the full `DataGrid.test.tsx` suite stayed **green (79/79)**. The
   guards enforce internal consistency and JS/CSS sync, which is all a jsdom test can do; the
   correctness of the measured terms rests entirely on live measurement. That limit is honestly
   disclosed in the constants' own doc comments, and I have now independently reproduced the
   measurements — but it is the reason this ticket needed a live sweep and will need one again if
   the row recipes change. **Editorial.**
3. **CR3 (the three `preview` call sites) remains unverified by me too.** As agreed, not a REFUTE
   basis. I attempted it — no `.ui-data-grid--preview` rendered on the Data Sources detail or
   Pipeline detail pages I could reach without authoring new data, so I could not measure the
   `--preview` `margin-top` collapse risk either. The follow-up should carry the risk as named.

### Dev-DB disclosure

I wrote `columnFilters` to the Output behind the "Projections 2026 table" panel on the shared dev DB
(`quick: "zzzznomatchzzzz"`, then `"WR"`) to reach the filtered-empty and matching-filter states.
**Both were cleared and the cleanup verified after a fresh page load** — the toggle reads `Filters`
with no count, i.e. no persisted filter remains. I also switched the theme to light and back to
dark, and nudged one column's width by 10px via the keyboard resize handle (panel layout state).
Nothing else was persisted; no dashboards, panels, outputs or pipelines were created or deleted.

### Evidence

Screenshots in `/home/matt/Development/helio/.concertino/runs/HEL-451/evidence/`:
`sk4-01-dashboard.png`, `sk4-02-modal-sticky-dark.png`, `sk4-03-seam-dark.png`,
`sk4-04-panel-sticky-dark.png`, `sk4-05-light-empty-expanded.png`,
`sk4-06-light-empty-collapsed.png`, `sk4-07-dark-expanded-parity.png`.
