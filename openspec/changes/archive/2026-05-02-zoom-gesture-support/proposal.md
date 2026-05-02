## Why

Users with a mouse wheel or trackpad have no gesture-based way to zoom the panel grid — they must click the +/− buttons. Adding Ctrl+scroll and pinch-to-zoom brings parity with common canvas/map conventions and makes zoom feel first-class.

## What Changes

- Attach a `wheel` event listener to the panel grid container in `PanelList.tsx`; when `ctrlKey` (or `metaKey`) is held, call `handleZoomChange` with a delta derived from `deltaY`, preventing default scroll; otherwise let the event pass through.
- For trackpad pinch, the browser emits `wheel` events with `ctrlKey=true` and a `deltaY` proportional to the pinch spread — the same handler covers both cases.
- Snap the resulting zoom value to the nearest 0.1 step (consistent with the existing button step size).
- Guard the listener with `{ passive: false }` so `preventDefault()` is honoured.

## Capabilities

### New Capabilities

- `panel-grid-zoom-gestures`: Ctrl+scroll and trackpad pinch gesture handling on the panel grid container, snapping to discrete zoom steps without conflicting with plain scroll.

### Modified Capabilities

<!-- No existing spec-level requirement changes — existing zoom range/persistence behaviour is unchanged. -->

## Impact

- `frontend/src/components/PanelList.tsx` — add `useEffect` with `wheel` listener on the grid container ref.
- `frontend/src/components/PanelList.test.tsx` — add gesture interaction tests.
- No backend changes required.
- No new dependencies.

## Non-goals

- Touch `touchstart`/`touchmove` multi-touch handling (trackpad pinch is already covered via `wheel` with `ctrlKey`).
- Smooth/animated zoom transitions (out of scope for this ticket).
- Changing the zoom step size or range.
