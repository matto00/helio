## ADDED Requirements

### Requirement: Ctrl+scroll adjusts zoom level on the panel grid

The panel grid container SHALL attach a non-passive `wheel` event listener. When the event has `ctrlKey` or
`metaKey` set to `true`, the handler SHALL call `preventDefault()` to suppress browser/OS default behavior,
compute a zoom delta from `event.deltaY` (accounting for `deltaMode`), clamp the result to the range [0.5, 2.0],
snap to the nearest 0.1 step, and invoke `handleZoomChange` with the snapped delta relative to the current zoom
level. When neither `ctrlKey` nor `metaKey` is set, the handler SHALL do nothing (allowing normal scroll).

#### Scenario: Ctrl+scroll down zooms out one step

- **WHEN** the user holds Ctrl and scrolls down (positive `deltaY`, `deltaMode=0`) while the pointer is over the panel grid
- **THEN** the zoom level decreases by 0.1 (snapped), the zoom container re-scales, and the browser's native page scroll does not occur

#### Scenario: Ctrl+scroll up zooms in one step

- **WHEN** the user holds Ctrl and scrolls up (negative `deltaY`, `deltaMode=0`) while the pointer is over the panel grid
- **THEN** the zoom level increases by 0.1 (snapped), the zoom container re-scales, and the browser's native page scroll does not occur

#### Scenario: Plain scroll is unaffected

- **WHEN** the user scrolls (no modifier key) over the panel grid
- **THEN** the zoom level does not change and the page scrolls normally

#### Scenario: Zoom does not go below minimum

- **WHEN** the current zoom level is 0.5 and the user Ctrl+scrolls down
- **THEN** the zoom level remains at 0.5

#### Scenario: Zoom does not exceed maximum

- **WHEN** the current zoom level is 2.0 and the user Ctrl+scrolls up
- **THEN** the zoom level remains at 2.0

### Requirement: Trackpad pinch adjusts zoom level on the panel grid

The trackpad pinch gesture SHALL adjust the zoom level using the same handler as Ctrl+scroll. On trackpad devices
the browser synthesizes `wheel` events with `ctrlKey=true` during a pinch gesture; the handler MUST prevent
default and adjust zoom identically to a Ctrl+scroll event. No separate touch-event handler is required.

#### Scenario: Pinch out zooms in

- **WHEN** the user performs a pinch-out gesture on the panel grid (browser emits wheel events with `ctrlKey=true` and negative `deltaY`)
- **THEN** the zoom level increases toward 2.0 in 0.1 increments as the gesture progresses

#### Scenario: Pinch in zooms out

- **WHEN** the user performs a pinch-in gesture on the panel grid (browser emits wheel events with `ctrlKey=true` and positive `deltaY`)
- **THEN** the zoom level decreases toward 0.5 in 0.1 increments as the gesture progresses

### Requirement: Gesture listener is properly lifecycle-managed

The `wheel` event listener SHALL be registered with `{ passive: false }` via `addEventListener` in a `useEffect`
hook scoped to the zoom container element ref. The listener SHALL be removed via `removeEventListener` in the
`useEffect` cleanup function to prevent memory leaks and duplicate handler registration.

#### Scenario: Listener is cleaned up on unmount

- **WHEN** the PanelList component unmounts (e.g. user navigates away)
- **THEN** the wheel listener is removed and no further zoom changes occur from wheel events on that element

#### Scenario: deltaMode line/page values are normalized

- **WHEN** a wheel event has `deltaMode=1` (DOM_DELTA_LINE) or `deltaMode=2` (DOM_DELTA_PAGE) with `ctrlKey=true`
- **THEN** the handler scales `deltaY` by the appropriate factor (24px per line, 600px per page) before computing the zoom delta, preventing unexpectedly large zoom jumps
