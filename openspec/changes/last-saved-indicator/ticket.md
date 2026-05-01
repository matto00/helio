# HEL-226 — Add "Last saved" indicator with save-now to dashboard toolbar

## Context

HEL-156 introduced batch accumulation of panel writes (`pendingPanelUpdates` in `panelsSlice`) with a 250ms debounce flush via `POST /api/panels/updateBatch`. That debounce is too aggressive for a save operation — this ticket replaces it with a 30-second auto-save interval and adds a visible "Last saved" indicator so the user always knows the state of their work.

## What changes

**Save interval**: Replace the 250ms debounce timer in `PanelGrid.tsx` with a 30-second interval. The pending update map continues to accumulate changes as before; the flush just happens less frequently.

**Save state indicator**: A small label positioned next to the dashboard title in the top-left toolbar showing one of two states:

* **Clean** (no pending updates): "Last saved 2 minutes ago" — relative timestamp that ticks live ("just now" → "X seconds ago" → "X minutes ago")
* **Dirty** (pending updates exist): "Unsaved changes"

In both states, hovering the label reveals a "Save now" link that immediately flushes `pendingPanelUpdates` via `updatePanelsBatch` and resets the auto-save timer.

**Navigation guard**: Add a `beforeunload` handler that fires when `pendingPanelUpdates` is non-empty, prompting the user before they leave the page with unsaved changes.

## Implementation notes

* `lastSavedAt: number | null` timestamp should live in `panelsSlice` state, set to `Date.now()` on `updatePanelsBatch.fulfilled`
* The relative label ("just now", "X seconds ago", "X minutes ago") needs a `setInterval` tick — a custom hook is the cleanest home for this
* The auto-save timer and the save-now action should share the same flush logic (no duplication)
* The indicator should only render when a dashboard is open (not on the empty/loading state)

## Acceptance criteria

- [ ] Panel title and appearance changes flush via `POST /api/panels/updateBatch` no more frequently than every 30 seconds during continuous editing
- [ ] A save state label is visible in the dashboard top-left area near the title at all times when a dashboard is open
- [ ] Label reads "Unsaved changes" when `pendingPanelUpdates` is non-empty, and "Last saved X ago" when clean
- [ ] The relative timestamp updates live without a page refresh (e.g. transitions from "just now" to "2 minutes ago" over time)
- [ ] Hovering the label in either state reveals a "Save now" control
- [ ] Clicking "Save now" immediately dispatches `updatePanelsBatch`, clears pending updates, updates the last-saved timestamp, and resets the auto-save timer
- [ ] Navigating away (page close, tab close) with unsaved changes triggers a browser `beforeunload` confirmation
- [ ] No `beforeunload` prompt fires when there are no pending changes
