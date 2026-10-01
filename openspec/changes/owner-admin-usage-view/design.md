## Context
HEL-1208 added V113 rollup tables (`product_event_daily`, `product_active_users_daily`, `product_ttfd_daily`, `product_event_property_daily`, `product_rollup_state`), materialized on the scheduler tick. The tables hold aggregates only (no user id) and carry no RLS. `product_events` is FORCE-RLS owner-isolated; rollups are written on the privileged pool.

## Goals / Non-Goals
Goals: owner-only read endpoint + page. Non-goals: per-user drill-down, new tables, new chart library, changing rollup semantics.

## Decisions
1. **Endpoint**: `GET /api/admin/usage?days=<1..90, default 30>`; response JSON of aggregates keyed by day (UTC). Gate: a new `AdminAccessService.guardOwner(user)` loads the user via `userRepo.findById` (fail closed on missing) and returns `Left(ChatAccessError.TierForbidden("Owner access required"))` unless `tier == UserTier.Owner`; the route maps it with the existing `TierErrorCompletion.completeTierError`, so the wire shape is the existing `TIER_FORBIDDEN` 403 body. Never gate by client-supplied data.
   - `days`: optional, integer 1..90, default 30; non-numeric or out of range -> 400 (not clamped), with a test for each.
   - Window: the last `days` UTC days ending at `rolled_through` (the last fully rolled day). Days with no rollup row are returned as explicit zero entries for count series (signups, provenance opens, DAU) so charts have a continuous axis; WAU and TTFD for a day lacking data are `null` (never 0) and render as gaps. Empty rollups / null `rolled_through` -> 200 with `rolledThrough: null`, all counts zero-filled over the window ending at today (UTC), funnel zeros, empty template list, and the page shows an empty state.
   - Contract delta: add a response JSON Schema under `schemas/`, spray-json formatters in `JsonProtocols`, and an OpenAPI entry under `openspec/` per the repo's schema-drift check (task 1.7).
2. **DB role/pool (decided)**: V113 creates the rollup tables with no RLS, owned by the migrating app-pool role, with an explicit `GRANT SELECT,... TO helio_privileged`. Reads run via `DbContext.withSystemContext` (privileged pool, `helio_privileged`, the same pool the rollup writes use), so the explicit V113 GRANT is the access path and no V114 is expected. The rollup tables contain no user id, so no per-user context is involved. The executor MUST prove the read under a non-superuser role holding only that grant (recipe in `FlywayNonSuperuserMigrationSpec`); if that proof fails, a V114 GRANT is required (tell the driver first). Task 1.6 may not be ticked until this is proven.
3. **Funnel**: counts from `product_event_daily` (`active_users` per event = distinct users) for `firstrun_file_dropped`, `firstrun_dashboard_created`, `first_dashboard_rendered` over the window; conversion = stage/previous stage. The funnel is by event day, not a strict cohort; the page labels it as such.
4. **Template counts** from `product_event_property_daily` (`firstrun_template_chosen`, key `template`), including the `other` bucket.
5. **TTFD**: per-day median/p90/sample_count from `product_ttfd_daily`; page labels "New users only (users who signed up after telemetry shipped)". Window-level TTFD is shown per-day plus a sample-weighted summary is NOT computed (percentiles are not averageable); show latest-day-with-samples and the per-day series.
6. **WAU null**: `weekly_active_users` can be NULL; return null and render a gap, never 0.
7. **Frontend**: new `features/adminUsage/` (service, slice/hook, page). Route `/admin/usage`; nav entry rendered only when `user.tier === "owner"`; the route itself renders a not-found/redirect for non-owners (server 403 is the real gate). Charts use the app's existing ECharts-based helpers (`buildChartOption`/theme) and DESIGN.md tokens; no new library. Both themes, desktop and phone widths, a11y: charts have text alternatives (accessible table or summary).
8. **Verification**: seeded-events test drives `POST /api/events` / real `ProductEventService` + server-side signup, runs the real rollup (`rollupDay`/`tickAt`), then asserts exact endpoint numbers. A role test proves the read under a non-BYPASSRLS role. Red-first: show free/beta get 403 on main with the route stubbed (or route absent), then 403 after.
9. HEL-1219 (no test that the tick calls rollup/purge): out of scope unless the seeded test naturally covers `tickAt`; if folded in, state so.

## Risks
- Rollup freshness: lags by one scheduler tick; the page shows `rolled_through` ("data through <date>") so staleness is visible.
- Shared dev DB: test data by exact id; delete via normal deletes only.

## Non-superuser read proof (task 1.6, executed)
`ProductUsageRepositoryRoleSpec` migrates the whole chain as a non-superuser, non-BYPASSRLS table owner (`FlywayNonSuperuserMigrationSpec` recipe), then flips `helio_privileged` to `NOSUPERUSER NOBYPASSRLS` (it is created BYPASSRLS first because earlier migrations such as V41 depend on it, as in production) and runs the real `ProductUsageRepository`/`AdminUsageService` read through the privileged pool (`SET ROLE helio_privileged`). Results: the role is confirmed `rolsuper=false, rolbypassrls=false`; reading `product_events` fails (so the page provably never scans it); all four rollup tables plus `product_rollup_state` read correctly through V113's explicit GRANT alone; and after `REVOKE SELECT ON product_event_daily FROM helio_privileged` the read fails, then succeeds again once re-granted (the grant is the access path, not a superuser/RLS accident). **No V114 is needed.**

## Implementation notes
- No OpenAPI document exists in this repo; the contract delta is `schemas/admin/admin-usage-response.schema.json` (drift-checked against `AdminUsageProtocol`) plus this change's `owner-usage-admin` spec.
- While `rolled_through` is null the service returns the zero-filled window and reads no rollup rows (yesterday/today recompute rows exist but are not final).
- Frontend state is a local hook (`useAdminUsage`), not a Redux slice: nothing else reads it. The owner nav entry is appended by `useNavDestinations` (sidebar + bottom nav); the route renders the not-found page for non-owners.
