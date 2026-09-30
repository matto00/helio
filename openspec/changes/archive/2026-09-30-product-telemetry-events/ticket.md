# HEL-1208: First-party product telemetry: product_events table + allow-listed POST /api/events + aggregate rollups

## Description

Leaf 3 of epic HEL-916. The epic is judged on time-to-first-dashboard (TTFD) and provenance-popover opens. Helio has no product analytics; `audit_events` is a security log of mutations, not product events. Owner rulings: first-party in our Postgres (no vendor, no client SDK, nothing leaves our infrastructure); keep BOTH per-user event rows AND aggregate rollups; the owner will soon want an admin view of aggregate usage (separate later leaf HEL-1211, owner-only), so rollups must serve: signups/day, TTFD distribution (median, p90), first-run funnel conversion, template choice counts, provenance opens/day, DAU/WAU. The per-user retention window was NOT set by the owner: 90 days is a DRIVER DEFAULT, not an owner ruling.

Scope:
* Migration V113 (reserved by the driver; V114 free if a second is justified in design): `product_events` table, event name from an allow-listed enum, user id, occurred_at, small typed properties object with per-event allow-listed keys (no free-form payload, URLs, content, PII). RLS per repo pattern; Flyway runs as the non-BYPASSRLS `helio` role (MISTAKES.md, v0.7.x incident).
* `POST /api/events`: authenticated, small batch, unknown events/properties rejected with 400. Own rate limit (separate limiter instance like SOURCE_FETCH_RATE_LIMIT_PER_WINDOW; document any new env var in CLAUDE.md env table). Client fire-and-forget.
* Aggregate rollup: daily counts per event plus TTFD distribution. Decide materialized-on-tick vs compute-on-read. Per-user rows purged after a fixed window, rollups kept. Account deletion removes that user's rows (FK ON DELETE CASCADE if no deletion path exists).
* Client helper: one typed `track(event, props)` with an offline-tolerant batch.
* Initial events: `signup_completed` (server-side, AuthService.register), `first_dashboard_rendered` (client, once per user; define exactly; dedupe server-side), `provenance_opened` (fill HEL-1207's no-op `onProvenanceOpened` hook), and declared-only `firstrun_file_dropped`, `firstrun_dashboard_created`, `firstrun_template_chosen` (emitted by later leaves).
* TTFD = `first_dashboard_rendered.occurred_at - signup_completed.occurred_at` per user; define exactly in the spec; decide backfill vs exclude for pre-ship users and state it.

## Acceptance Criteria

* Unknown events and properties are rejected (red-first test).
* A user's events never appear in another user's reads. No reads for non-owners in this leaf.
* The rollup produces correct daily counts and a TTFD distribution from fixture events. The retention purge is tested with time injected, never a wall-clock wait.
* No measurable UI latency: `track()` never blocks rendering; errors are swallowed and logged once.
* Reproduce RLS behaviour as a non-superuser (non-BYPASSRLS) role where feasible; migration checked for prod-role behaviour.
