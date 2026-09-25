## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit `9e4391801755e9b49efa20d6ba56e1f1f0afecfd` (HEAD at the moment
the diff below was read), diffed against `BASE_SHA=e195481a46e026a32a4aa189487cdd4a8b78f9e2`
(resolved live via `scripts/concertino/resolve-review-base.sh`, matching what
both the executor's `files-modified.md` and the evaluator's `evaluation-1.md`
used). One commit, 32 files changed. Every claim below is from evidence I
gathered myself this round — code read directly, gates re-run fresh, and live
browser interaction against the real dev servers — not taken from the
evaluator's or executor's reports, which I treated only as claims to verify.

### Gates re-run fresh (all green)

```
npm run lint          → eslint src --max-warnings=0 — clean, zero output
npm run typecheck      → tsc --noEmit — clean, zero output
npm test (full suite)  → 346 suites / 3816 tests passed, 0 failed, 33.6s
npm run format:check   → "All matched files use Prettier code style!"
npm run build           → succeeded (vite build; pre-existing >500kB chunk
                           warning only, unrelated to this diff)
```

Also ran the ticket's own new suites in isolation first
(`chartClickSelection|ChartPanel.click|PanelCard.inspect|PanelInspectView|panelsSlice|PanelFullscreenOverlay`):
7 suites / 84 tests, all passed.

### Acceptance criteria — traced to evidence

1. **"Clicking a chart element opens an inspect view listing exactly the
   underlying rows... with a labeled header and a clear/return control."**
   Traced to `PanelInspectView.tsx` (wraps `Modal`, renders `DataGrid` +
   header + clear control) and `filterRowsForSelection`/
   `mapChartClickToSelection` in `chartClickSelection.ts`. Independently
   live-verified: created my own dashboard/source/pipeline/chart-output/panel
   via the API (a pie chart, `region`/`revenue`, rows `East/100`,
   `West/150`), dispatched a real `MouseEvent` onto the live ECharts canvas
   at pixel coordinates landing inside the "West" slice. Result: the Inspect
   dialog opened with header "Showing rows for region: West / revenue" and a
   `DataGrid` showing exactly one row (`West | 150`), not both rows. Met.
2. **"Selected-point descriptor stored in reusable panel-interaction state,
   cleared on panel/dashboard switch."** Traced to `panelsSlice.ts`:
   `interactionState: Record<string, SelectionDescriptor | null>`,
   `selectDataPoint`/`clearSelection` reducers, cleared in
   `deletePanel.fulfilled` and `fetchPanels.pending` (the dashboard-switch
   signal). Verified the reducer tests exist and are real (not vacuous) by
   reading `panelsSlice.test.ts:365-380` and `:436-451` myself — a
   `selectDataPoint` on `panel-2` does not touch `panel-1`'s entry, and
   `deletePanel.fulfilled` for `panel-1` leaves `panel-2`'s selection intact.
   Met.
3. **"Clickable elements have a pointer cursor; an equivalent inspect entry
   exists in the panel menu for keyboard users."** Traced to
   `withPointerCursor` in `ChartPanel.tsx` (unconditional post-process over
   every `buildDataOption` branch's `series` array) and the `ActionsMenu`
   "Inspect" item in `PanelCard.tsx`, gated on `chartInspectConfig`.
   Independently re-ran `e2e/hel572-chart-click-drilldown.spec.ts` fresh (see
   below) — the keyboard-only test passed, confirming focus lands inside the
   dialog after `ActionsMenu → Inspect` with no chart click at all. Met.
4. **"No regression to rendering/tooltips. Unit tests for click→column
   mapping and row-filtering; lint/test pass, zero new warnings."** Full
   suite green (see gates above), including the pre-existing
   `ChartPanel.test.tsx` tooltip/hover-emphasis tests, unchanged and passing.
   `chartClickSelection.test.ts` (285 lines) covers all four chart-type
   branches (bar/line single-series, multi-series grouped, auto-detected
   multi-series, pie mapped-y/auto-detected, scatter grouped/ungrouped) plus
   a dedicated "click mapping and row filtering agree on the same selection"
   regression-guard section. Met.

### Spec-vs-design divergence (D5) — independently verified, not taken on
either report's word

`design.md`'s D5 prose is stale: it says the clear/return control "calls
`onClose` (which both closes the view and dispatches `clearSelection`)."
`specs/chart-drilldown-inspect/spec.md`'s "The selection descriptor is view
state..." requirement is unambiguous and contradicts that sentence: closing
the *same panel's* inspect view without the explicit clear/return control
must NOT clear the selection.

I read `PanelInspectView.tsx`, `PanelCard.tsx`, and
`PanelFullscreenOverlay.tsx` directly: `onClose` (wired to `Modal`'s own
Escape/backdrop/× dismissal — confirmed in `Modal.tsx` that Escape's native
`cancel` handler and backdrop clicks both route through `onClose` only, never
a separate clear path) never dispatches `clearSelection`; only `onClear` (the
footer "Clear selection" button, `selection ? onClear : onClose` in
`PanelInspectView.tsx:103`) does. `PanelCard.tsx`'s `handleCloseInspect`
(`setIsInspectOpen(false)` only) vs `handleClearInspect`
(`setIsInspectOpen(false)` + `dispatch(clearSelection(...))`) confirms this
in both mount points (`PanelFullscreenOverlay.tsx` mirrors it exactly).

I then reproduced the round-trip live, myself, in the browser (not reading
the executor's or evaluator's screenshots):
1. Clicked the pie's "West" slice → Inspect opened, "Showing rows for
   region: West / revenue", row `West/150`.
2. Pressed Escape → dialog closed.
3. Reopened via `ActionsMenu → Inspect` → **the same selection was still
   there** ("Showing rows for region: West / revenue", `West/150`) — Escape
   did not clear it.
4. Clicked "Clear selection" → dialog closed.
5. Reopened via `ActionsMenu → Inspect` → the empty state ("Nothing
   selected") rendered, footer now read "Close" instead of "Clear
   selection".

This is exactly spec.md's requirement, correctly implemented, correctly
diverging from design.md's stale sentence (which the code comments at
`PanelInspectView.tsx:19-32`, `PanelCard.tsx:290-294`, and
`PanelFullscreenOverlay.tsx:93-96` all explicitly flag and cite spec.md for).
Non-blocking: design.md's D5 prose itself should get a one-line correction
at archive time so a future reader isn't misled — same note the evaluator
already made.

### panel-body-click collision resolution — verified live, both directions

- A click that resolves to a genuine series element (`componentType ===
  "series"`) calls `stopPropagation` on the native event before anything
  else (`ChartPanel.tsx:550-567`, confirmed by `ChartPanel.click.test.tsx`'s
  "stops propagation even when no mapping is possible" test, which
  specifically probes the ordering risk design.md's own Risks section
  flags).
- A miss-click that lands on non-series canvas area (or a legend/empty-grid
  click) does NOT call `stopPropagation` and correctly falls through to
  `DesktopPanelGrid`'s `article onClick` handler, opening the panel's
  "Customize" (`PanelDetailModal`) — I reproduced this myself twice
  (accidentally, while hunting for a bar chart's clickable pixel region
  before switching to a pie) and it worked exactly as designed both times.
- `DesktopPanelGrid.tsx` is untouched by this diff (confirmed — not in
  `git diff --stat`), matching design.md D2's claim that the interception
  happens entirely inside `ChartPanel` via `stopPropagation`, with zero
  changes to the card-click handler itself.

### HEL-1178 (appearance-conditional dead click wiring) — genuinely closed

`withPointerCursor` (`ChartPanel.tsx:85-89`) is applied to
`buildDataOptionCore`'s returned `series` array unconditionally — merged
onto the DATA-derived half of the option, never the `appearance`-derived
half — so it applies regardless of whether `appearance?.chart` is set.
`resolveChartType(undefined)` (`chartAppearance.ts`) defaults to `"line"`,
the same default the click handler and inspect-config resolution both use,
so a panel with no stored appearance still gets a mappable chart type, not a
silently-unwired one.

Independently reproduced live: created a chart panel via the API with
`appearance.chart` left entirely unset (matching the e2e spec's
`setPieAppearance=false` scenario). Re-ran
`e2e/hel572-chart-click-drilldown.spec.ts` fresh myself
(`DEV_PORT=6004 BACKEND_PORT=8911 npx playwright test
e2e/hel572-chart-click-drilldown.spec.ts --reporter=list`) — all 3 tests
passed, including "ActionsMenu Inspect entry still works with NO stored
appearance.chart (tasks.md 6.5, HEL-1178)":

```
✓ keyboard-only: ActionsMenu Inspect opens the view with focus inside it (tasks.md 5.2) (4.8s)
✓ clicking inside Fullscreen opens Inspect nested on top; Escape closes only Inspect (tasks.md 4.3) (2.5s)
✓ ActionsMenu Inspect entry still works with NO stored appearance.chart (tasks.md 6.5, HEL-1178) (2.8s)
3 passed (10.5s)
```

### Fullscreen/grid parity and Escape-stacking

Traced `PanelFullscreenOverlay.tsx` and confirmed it mirrors `PanelCard.tsx`
exactly (own `isInspectOpen` local state, same `onClose`/`onClear` split,
`variant="full"` vs `"preview"`). The e2e "clicking inside Fullscreen opens
Inspect nested on top; Escape closes only Inspect" test — which asserts
`dialog[open]` count goes 2→1 after one Escape press and the Fullscreen
dialog remains visible — passed on my fresh re-run above, confirming native
`<dialog>` stacking works without bespoke logic, per design.md's Context
section.

### Light/dark parity — visually judged, screenshots persisted

Toggled the theme via Settings → Appearance (the only theme control in this
app; there is no in-place toggle on the dashboard view itself, so a full
navigate-away/navigate-back was unavoidable — noting this as a deviation
from C9's literal "without navigating away," though the resulting check
still validates what C9 exists to catch: a remount reads current DOM state
correctly by construction, so this specific check does not depend on the
toggle-while-mounted timing hazard C9 targets, which HEL-566 already fixed
and this ticket does not touch). Re-opened the same pie panel's Inspect view
in both themes:
- `.concertino/runs/HEL-572/evidence/skeptic-pie-inspect-open-light.png`
  (dark theme — mislabeled by me before I discovered the account's
  persisted theme was dark; see below)
- `.concertino/runs/HEL-572/evidence/skeptic-pie-inspect-open-actual-light.png`
  (confirmed light theme, `document.documentElement[data-theme]` read
  directly before toggling)

Both render correctly: surfaces/borders/text flip appropriately, `DataGrid`
readable in both, "Clear selection" styled as the same secondary button
pattern used elsewhere. `PanelInspectView.css` uses only
`--space-*`/`--app-*`/`--text-*` tokens (confirmed by reading the file — 16
lines, `--space-3`, `--space-2`, `--app-warning-surface`, `--app-text`,
`--app-radius-sm`, `--text-xs`; `--app-warning-surface` exists in both
light/dark blocks of `theme.css`). No hardcoded colors. Reuses `Modal`,
`DataGrid`, `EmptyState`, `IconButton`/`iconSize` — no reinvented
primitives.

**Correction to my own evidence:** my first two screenshots
(`skeptic-before-click-light.png`, `skeptic-pie-before-click-light.png`,
`skeptic-pie-inspect-open-light.png`) are mislabeled — the browser's
persisted session was already in dark mode, which I didn't confirm until
later via `document.documentElement.getAttribute('data-theme')`. The
`-actual-light.png` pair is the genuine light-mode capture. Flagging this
explicitly per this role's evidence-discipline: the labels in the filenames
are wrong, but the pixel content itself is real and was inspected before I
drew any conclusion from it, so this doesn't change the CONFIRM verdict —
just correcting the record.

### Console / no regressions

One recurring `[ERROR] Failed to load resource: 502 ... /api/pipelines/:id/run-events`
appeared during my session. Confirmed via `git diff --stat` that no SSE/
run-events file is touched by this change (the diff only lists the 32 files
in `files-modified.md`, none of which are `usePipelineRunEvents.ts` or any
backend route file) — pre-existing dev-environment behavior, not a
regression from this diff. No other console errors or warnings attributable
to the new code across ~20 interactions (clicks, menu opens, theme toggle,
navigation).

### files-modified.md / tasks.md accuracy

Cross-checked `files-modified.md`'s file list against `git diff --stat`
myself — exact match, nothing undisclosed. `tasks.md`: 23/23 items checked
`[x]`, 0 unchecked.

### Gate-defect check (per role instructions)

The evaluator's own report discloses no mtime-ordering-dependent evidence
claim that I found — its D5 verification and its own live screenshots are
described as directly re-derived/re-observed, not inferred from file
timestamps or directory placement. No gate defect to record on that front.

### Verdict: CONFIRM

Ships. All four acceptance criteria trace to real, independently-verified
evidence (not just re-reading the executor's/evaluator's claims); the
spec.md-vs-design.md D5 divergence is correctly resolved in the shipped
code and I reproduced the exact user-facing round-trip myself; HEL-1178 is
genuinely closed (live-verified, not just unit-tested); panel-body-click
collision resolution works in both directions; gates are green on a fresh
run; light/dark parity holds using design tokens throughout.

### Non-blocking notes

1. Same as the evaluator's suggestion #2: `design.md`'s D5 prose should get
   a one-line correction at archive time (the "`onClose`... both closes...
   and dispatches `clearSelection`" sentence) so a future reader isn't
   misled — spec.md is binding and internally consistent with the shipped
   code, so this is purely a stale-artifact cleanup, not a functional gap.
2. `ChartPanel.tsx` (~610 lines) and `ChartPanel.test.tsx` (~1100 lines) are
   both well past CONTRIBUTING.md's informational ~400-line split
   threshold; already flagged as follow-up candidates in
   `files-modified.md`. Recommend actually filing these as Linear tickets
   per Standing Constraint C10 before archival, rather than leaving them
   only as prose.
3. My own first three screenshots this round were mislabeled "light" while
   actually dark-theme (session default) — see the correction above. The
   `-actual-light.png` pair is the genuine light-mode evidence; both pairs
   are persisted under `.concertino/runs/HEL-572/evidence/` for anyone who
   wants to check my work.
