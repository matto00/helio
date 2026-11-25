## Why

`e2e/hel1510-output-editor-table-overflow.spec.ts` fails occasionally with a ~0.1px card overflow. HEL-1613 refuted
font swap and measured the Output editor modal's entrance animation (`ui-modal-in` in
`frontend/src/shared/ui/Modal.css`: `translateY(--motion-rise-distance) scale(0.985)` -> `none`) still moving the
Configuration card's content-right edge by up to ~0.69px during the first ~100ms. The spec reads `limit` (card
content-right + 0.5) once, then reads each control's right edge in a later loop; a `limit` read mid-entrance and
controls read at rest gives a false overflow.

## What Changes

- Reproduce the race red first in a committed probe: force the `limit` read to happen while the dialog's entrance
  animation is held mid-flight, controls read after it is released/finished; show the real assertion fails.
- Make the spec wait for the dialog's own entrance animation(s) to finish (`getAnimations().finished` on the
  `dialog` element) before any geometry read. Mutation: remove the wait -> red again under the force.
- No added tolerance (the existing `+ 0.5` stays as is), no retries, no timeout changes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None (e2e test-only change; `skip_specs: true`).

## Impact

- `e2e/hel1510-output-editor-table-overflow.spec.ts` (and, only if reused elsewhere, a small helper in `e2e/support/`).
- No product code, no schema, no migration, no backend.

## Non-goals

- Changing the modal animation or its duration, or Modal.css at all.
- Converting the spec to `waitForWebFonts` (HEL-1613 refuted fonts; HEL-1622 owns font waits).
- Sweeping other specs for the same race.
