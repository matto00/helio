## Why

The `/settings` audit-log table loads asynchronously (its own `fetchAuditEvents()` on mount) and renders roughly
300 ms after the Appearance heading (HEL-1288). An e2e spec that measures or counts on `/settings` as soon as the page
"looks loaded" can observe a partial page. There is no shared readiness gate; each spec would have to reinvent one.

## What Changes

- Add a shared e2e helper in `e2e/support/` that waits until `/settings`'s audit-history section has rendered its
  table with sort controls (no new assertion on existing behaviour, default Playwright timeout, no timeout literals).
- Call it in the non-guard specs that measure on `/settings`: `e2e/hel813-mobile-touch-target-floor.spec.ts`
  (surface 2 swatch row; surface 3 toast close) immediately after their `page.goto("/settings")`.
- Record the full inventory (including specs inventoried but deliberately not touched, with reasons) in the change.
- Prove need and fix with an uncommitted scratch probe (red: count at heading-visible < full; green: count after
  helper == full), plus `--repeat-each 10` at 2 workers on the touched spec.

## Non-goals

- `e2e/focus-presence-guard.spec.ts` and `e2e/state-surface-contrast-guard.spec.ts` (HEL-1288 PR #774 / HEL-1330).
- Any change to an existing assertion, timeout, `playwright.config.ts`, CI workflow, or app code.
- Making the audit table render faster.

## Capabilities

### New Capabilities

None — test tooling only; no spec-level behaviour changes (`skip_specs: true`).

### Modified Capabilities

None.

## Impact

- New: `e2e/support/settingsReady.ts`. Modified: `e2e/hel813-mobile-touch-target-floor.spec.ts` (two call sites).
- CI `e2e` job runs the touched spec; added wall time is bounded by the audit fetch (~hundreds of ms per test).
