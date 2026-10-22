## Why

`e2e/hel1656-pull-to-refresh.spec.ts` "a scrolled page scrolls natively upward and never engages" fails intermittently
on CI (runs 39463951430 e2e (2) and 39517434455 e2e (4)): after `scrollTop = 300` the 150 px downward CDP drag never
scrolls the page, so the poll for a smaller `scrollTop` times out. The pull gesture never engages (no indicator, the
touchstart is ineligible because `scrollTop > 0`). A planning probe found the cause: the drag starts at a fixed
viewport point `(width / 2, 300)`, and whatever element lies there depends on not-yet-settled layout. When that point
is the Table panel's column-resize handle (`.ui-data-grid__resize-handle`, deliberately `touch-action: none`), Chromium
never starts a native pan: every touchmove stays cancelable, nothing prevents it, and `scrollTop` never moves.

## What Changes

- The test waits for settled layout and a settled `scrollTop` (state waits over consecutive frames, never a sleep)
  before it samples the start position.
- The drag starts on a plain, natively pannable content point chosen from the rendered layout (a markdown Notes card
  body inside the viewport), not a fixed coordinate, and the test asserts that precondition (no `touch-action` other
  than `auto` on the hit chain, no nested scroller) so a future layout that puts a control under the finger fails with
  a clear message instead of a 5 s poll timeout.
- No app change: the gesture is not engaging on a scrolled page; the stuck scroll is the resize handle's intended
  `touch-action: none`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (test-only; `skip_specs: true`).

## Non-goals

- Changing the DataGrid resize handle or its `touch-action` on phones (a follow-up candidate, not this ticket).
- Retries, larger timeouts, or touching other HEL-1656 tests.

## Impact

`e2e/hel1656-pull-to-refresh.spec.ts` only.
