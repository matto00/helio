## Why

The trust/zero-to-dashboard epic (HEL-916) is judged on time-to-first-dashboard and provenance-popover opens, and Helio has no product analytics. `audit_events` is a security log, not a product-event store. The owner wants first-party telemetry (no vendor) with per-user rows and aggregate rollups, and an admin usage view soon after.

## What Changes

- New `product_events` table (V113) with RLS, FK `ON DELETE CASCADE` to `users`, allow-listed event names.
- New `POST /api/events` (authenticated, batch, strict allow-list validation, own rate limit, 400 on unknown event or property).
- Server-side `signup_completed` emitted from `AuthService.register`.
- Five rollup/state tables (`product_event_daily`, `product_active_users_daily`, `product_ttfd_daily`, `product_event_property_daily`, `product_rollup_state`) materialized on the existing scheduler tick, plus a retention purge (90 days, DRIVER DEFAULT not owner ruling) of per-user rows only after the rollup covers them. `signup_completed` and `first_dashboard_rendered` rows are exempt from purge (one timestamp-only row per user; needed for TTFD and dedupe).
- Frontend `track(event, props)` helper (offline-tolerant batch, fire-and-forget), `first_dashboard_rendered` emission, and filling HEL-1207's `onProvenanceOpened` hook with `provenance_opened`.
- Declared-only events for the first-run leaf.
- New env vars documented in CLAUDE.md.

## Capabilities

### New Capabilities
- `product-telemetry`: first-party product event ingestion, storage, rollups, retention, and the client `track` helper.

### Modified Capabilities

## Impact

Backend: migration V113, events repository/service/routes, rollup + purge wired into the scheduler tick, AuthService.register. Frontend: new telemetry module, provenance hook, dashboard render hook. Docs: CLAUDE.md env table. No existing API changes.
