## Why

The background-tint blend system shipped in v1.3.1 has hardcoded opacity constants that were
set speculatively. The dot-grid overlay, panel surface alpha floor, and
`resolveDashboardGridBackground` alpha values all need verification and tuning to feel
visually correct across light and dark themes with user-chosen background colors.

## What Changes

- Verify and tune the dot-grid overlay visibility in `App.css` across light/dark themes and
  background override combinations.
- Tune `resolveDashboardGridBackground` alpha values (currently 0.94 dark / 0.97 light) in
  `appearance.ts` for better grid visibility.
- Verify panel transparency slider range (0.9 → ~0.18 alpha at 100% transparency) is smooth
  and well-distributed across the slider travel.
- Tune the dashboard tint strength (0.22) and panel tint strength (0.24) if needed for
  better blend behavior.
- Add unit test assertions that lock down the tuned constants so they don't drift silently.

## Capabilities

### New Capabilities

- None

### Modified Capabilities

- `frontend-dashboard-polish`: dot-grid overlay visibility requirements updated to cover
  all theme/background combinations explicitly.
- `panel-appearance-settings`: panel transparency slider range behavior added as a
  verifiable requirement.

## Impact

- `frontend/src/theme/appearance.ts` — constant tuning for tint strength and alpha values.
- `frontend/src/app/App.css` — dot-grid overlay CSS may need opacity or color adjustments.
- `frontend/src/theme/appearance.test.ts` — new assertions for tuned constants.

## Non-goals

- Exposing tint strength as a user-configurable control (requires new UI, API schema changes,
  and persistence — tracked separately if desired).
- Changing the transparency slider range endpoints (0–100 UI mapping to 0.9–0.18 alpha is
  intentional; only the feel/distribution is in scope).
