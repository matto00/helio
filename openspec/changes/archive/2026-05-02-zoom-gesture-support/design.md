## Context

`PanelList.tsx` already owns zoom state (`zoomLevel`, `handleZoomChange(delta)`, `handleZoomReset`) and renders a
`panel-list__zoom-container` div that applies `scale(zoomLevel)`. The +/− buttons call `handleZoomChange(±0.1)`.
Zoom ranges from 0.5–2.0 and persists per-dashboard via `updateUserPreferences`.

The browser unifies Ctrl+scroll and trackpad pinch into a single synthetic `wheel` event with `ctrlKey=true` and
a `deltaY` proportional to gesture intensity. `preventDefault()` on this event suppresses the OS zoom-in/out
shortcut and default page scroll. Registering the listener as non-passive (`{ passive: false }`) is required to
call `preventDefault()` — React's synthetic event system cannot be used here because React registers wheel
listeners as passive by default since React 17.

## Goals / Non-Goals

**Goals:**
- Ctrl+wheel and trackpad pinch adjust zoom level via the existing `handleZoomChange` path
- Gestures snap to the nearest 0.1 step (matching button granularity)
- Plain scroll (no modifier) is unaffected
- Listener is attached to the `panel-list__zoom-container` div, scoped to the grid area

**Non-Goals:**
- Touch multi-touch handling (not needed — trackpad pinch is already a wheel event)
- Smooth animated zoom
- Changing step size, min, or max

## Decisions

### Decision: useEffect with native addEventListener, not React onWheel

**Chosen:** `useEffect` + `containerRef.current.addEventListener('wheel', handler, { passive: false })`

**Why:** React 17+ registers synthetic `onWheel` as passive, so calling `event.preventDefault()` inside an
`onWheel` JSX prop triggers a console warning and does not suppress the browser behaviour. A native listener
with `{ passive: false }` is the correct pattern and is well-established in the codebase (e.g. `PanelGrid`
uses refs for layout callbacks). The listener is cleaned up on unmount via the `useEffect` return function.

### Decision: Attach to the zoom container div, not document

Scoping to `panel-list__zoom-container` means the gesture only fires when the pointer is over the panel grid.
Attaching to `document` would intercept Ctrl+scroll anywhere in the app — including the sidebar — which is
unexpected.

### Decision: Clamp then snap to nearest 0.1

Raw `deltaY` values vary by device and OS. Divide by a sensitivity constant (100) to convert to a zoom delta,
apply the existing clamp (0.5–2.0), then round to one decimal place (`Math.round(raw * 10) / 10`). This keeps
the gesture consistent with the button step and avoids floating-point drift (e.g. `0.9000000001`).

Sensitivity constant 100 is chosen empirically: a typical one-notch mouse wheel produces `deltaY ≈ ±100`,
yielding a 0.1 step — identical to a button click. Trackpad pinch produces continuous small values that
accumulate naturally.

### Decision: Also check metaKey for macOS compatibility

On macOS, Cmd+scroll can also trigger the OS zoom. Including `metaKey` alongside `ctrlKey` ensures the handler
fires on both platforms consistently.

## Risks / Trade-offs

- `deltaMode` variation: `WheelEvent.deltaMode` can be `DOM_DELTA_PIXEL` (0), `DOM_DELTA_LINE` (1), or
  `DOM_DELTA_PAGE` (2). Most browsers use pixel mode for trackpad pinch/Ctrl+wheel, but the handler should
  guard for line/page mode and scale accordingly to avoid large jumps. → Mitigation: check `deltaMode` and
  multiply by line/page factors (24px/line, 600px/page) before dividing by sensitivity.
- Firefox on Linux may produce `deltaMode=1` for mouse wheel. The factor guard covers this.

## Planner Notes

- No backend changes, no new dependencies, no schema changes — self-approved.
- Existing tests in `PanelList.test.tsx` use `fireEvent` from `@testing-library/react`; the new gesture tests
  will use `fireEvent.wheel` with `ctrlKey: true` and `deltaY` values, which dispatches a native-like event
  that the ref-attached listener receives via JSDOM.
