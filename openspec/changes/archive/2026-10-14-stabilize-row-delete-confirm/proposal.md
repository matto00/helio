## Why

The overview-row Delete confirm (HEL-1574) still misbehaves: on freshly created rows at narrow widths a double-click
can retarget to a neighbouring row, the keyboard reveal at phone widths lands under the floating BottomNav, and a
pointer Delete on a bottom row opens a confirm the user cannot see. HEL-1574 needed nine cycles because each fix moved
one edge of this one widget; this change fixes the interaction as a whole and pins it with a regression matrix.

## What Changes

- Relative-time labels in the two overview tables read a shared minute tick instead of `Date.now()` per render, so
  opening a confirm (or any unrelated re-render) cannot change a label, a row height or a column width.
- A pointer activation of a row's Delete pins the clicked button's on-screen position across the commit that opens
  the confirm (compensating any layout shift above it, including closing another row's open confirm).
- A pointer activation reveals the confirm after the double-click window, rescheduled on each click and cancelled when
  the confirm closes. A keyboard activation still reveals immediately.
- At phone widths `.app-content` gets a `scroll-padding-bottom` equal to the BottomNav reserve, so every reveal clears
  the nav.
- The `test.fixme` 375px double-click e2e is re-enabled; new e2e cases cover fresh-row double-clicks, nav clearance,
  the deferred pointer reveal and a confirm switching rows.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `app-shell-rail`: the "Delete lives on the overview rows" capability gains a requirement that the confirm stays put
  under a double-click and opens in view, clear of the BottomNav.

## Non-goals

- No change to the confirm's placement, copy, button recipe, 44px expander, focus return or the HEL-1604 row-click
  guard (all owner rulings, kept as-is).
- No change to other `formatRelativeTime` callers (Connectors, Provenance, pipeline detail footer).
- The pre-existing squeezed Sources table at 375 / 820-list-400 (HEL-1582 territory).

## Impact

- `frontend/src/shared/chrome/rowDeleteFocus.ts` (+ test), a new `useNow` hook, `formatRelativeTime` (optional `now`).
- `PipelineListTable.tsx`, `SourceListTable.tsx`, `PipelinesPage.tsx`, `SourcesPage.tsx`: call-site edits only (HEL-1579 runs concurrently on the pipelines
  side; the PR body lists the shared files).
- `frontend/src/app/App.css` (phone `.app-content` rule); `shared/ui/ConfirmInline.tsx` (opt-in prop, set only by the
  two overview pages).
- `e2e/hel1574-shell-rail.spec.ts`.
