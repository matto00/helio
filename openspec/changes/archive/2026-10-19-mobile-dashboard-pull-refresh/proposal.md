## Why

HEL-1584 item 8b (split to this ticket): phone dashboard viewers have no way to ask for fresh panel data. The phone stack renders no per-panel Refresh control, and a browser-tab native pull-to-refresh reloads the whole app. The owner ruled (`suppress-on-phone-dashboard`) that the phone dashboard owns its own pull gesture, with the browser's overscroll contained on that one scroller.

## What Changes

- New `usePullToRefresh` gesture hook in `frontend/src/shared/motion/`: touch-event based (a pull on a scrolling body cannot use `useSheetSwipe`'s pointer capture), engaged only at scrollTop 0 on a downward, vertical-dominant, single-touch pull; non-passive `touchmove` calls `preventDefault` only while engaged. Reuses the velocity-window and token-timed settle approach from `useSheetSwipe`/`sheetMotion` (shared helpers extracted, not copied).
- A pull indicator rendered at the top of the phone panel stack, with Full-motion follow and token-driven release; Subtle/Off/reduced motion snap.
- A per-stack refresh registry: every output-bound `MobileStackPanelBody` registers its own `usePanelData` `refresh`/`isRefreshing`; a qualifying release calls each once and holds the busy state until all settle.
- `.app-content` gets `overscroll-behavior-y: contain` only while the phone dashboard stack is mounted at <= 768px (attribute toggled by the hook, CSS scoped to the attribute).
- No backend, API, or schema change. Desktop unchanged.

## Capabilities

### New Capabilities
- `mobile-dashboard-pull-refresh`: the phone dashboard's pull-to-refresh gesture, its engagement rules, overscroll containment scope, refresh fan-out, and motion-level behavior.

### Modified Capabilities

## Impact

- Frontend only: `frontend/src/shared/motion/` (new hook, shared drag helpers), `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` (+ css), `frontend/src/app/App.css` or the stack css (scoped containment rule), DESIGN.md §10/§12 (document the gesture).
- New e2e spec `e2e/hel1656-pull-to-refresh.spec.ts` (touch emulation); jest tests for the hook and registry.
- Request volume: at most one rows request per output-bound panel per pull, the same as tapping each panel's refresh once; guarded per panel.
