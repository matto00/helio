## Context

The RLS epic (HEL-272) applied FORCE RLS + policies on nine tables across three Flyway migrations
(V34–V36). Two correctness gaps remain: (1) no automated guard prevents a future migration from
shipping a new table without RLS; (2) `panels.owner_id` has no index, while the V36 panels_insert
and panels_delete policies filter on that column per-row.

The index audit found existing coverage for the primary hot paths:
- `idx_dashboards_owner_id` (V17) — covers `dashboards` owner and SELECT/UPDATE/DELETE policies.
- `idx_data_sources_owner_id`, `idx_data_types_owner_id` (V17), `idx_pipelines_owner_id` (V32) — cover V35.
- `idx_resource_permissions_grantee` (V16) — covers the named-grantee branch of `helio_can_access_dashboard`.
- `idx_resource_permissions_resource` (V16) — covers the resource_id lookup branch.

Missing: `panels.owner_id` — used by `panels_insert` (WITH CHECK) and `panels_delete` (EXISTS subquery
on `dashboards`). The panels_insert check is `NULLIF(current_setting(...), '')::uuid = owner_id`;
a seqscan on `panels` is acceptable at low row counts but not at scale.

## Goals / Non-Goals

**Goals:**
- Add V37 Flyway migration: `idx_panels_owner_id` + a composite
  `idx_resource_permissions_resource_grantee (resource_type, resource_id, grantee_id)` to support the
  inner EXISTS in `helio_can_access_dashboard` without double-index hop.
- Add `RlsPolicyGuardSpec`: queries `pg_class` / `pg_policies` in embedded postgres after all
  migrations run; asserts every expected table has `relrowsecurity = true` and `relforcerowsecurity = true`
  and at least one policy; serves as the regression guard for future tables.
- Update archived `repo-acl-enforcement/design.md` to close Q2.
- Verify `CONTRIBUTING.md` already documents `withUserContext` / `withSystemContext` pattern
  (it does — `## Database transactions & RLS context` section added in HEL-273).

**Non-Goals:**
- Live EXPLAIN ANALYZE benchmarks in CI (no stable seeded data; performance findings documented inline).
- Grafana pool metrics (no metrics infrastructure yet; follow-up ticket recommended).
- RLS on `auth_sessions`, `users`, or other non-ACL'd tables.

## Decisions

**D1 — Single V37 migration for all missing indexes.**
Rationale: both indexes are purely additive; no schema changes. Keeping them together reduces
migration count and makes the intent clear: "performance pass to support RLS policy predicates."

**D2 — `RlsPolicyGuardSpec` as a ScalaTest spec, not a shell script.**
Rationale: the rest of the test suite uses EmbeddedPostgres + ScalaTest. A Scala spec can run in
the existing `sbt test` gate, gets the full Flyway migration path, and produces readable ScalaTest
output. A shell script would require a live DB and would not run in CI.

**D3 — Guard by table name allowlist, not by exhaustive count.**
Rationale: the guard spec maintains an explicit `Set` of table names expected to have RLS. Adding
a new ACL'd table requires updating the set — which is a deliberate, reviewable change. Counting
all tables with RLS would be fragile if auxiliary tables like `pg_stat_*` views appear.

**D4 — Composite index `(resource_type, resource_id, grantee_id)` rather than just `(resource_id)`.**
Rationale: `helio_can_access_dashboard` queries `resource_permissions` with `resource_type`, `resource_id`,
AND `grantee_id` together. The existing `idx_resource_permissions_resource (resource_type, resource_id)`
covers the resource lookup but requires a heap fetch for `grantee_id`. The composite index covers all
three columns and allows index-only scans.

## Risks / Trade-offs

- [Risk: composite index on resource_permissions increases write overhead]
  → Mitigation: resource_permissions rows are written once per share action, a very low-frequency
  operation. The read benefit (per-row during dashboard queries) vastly outweighs the write cost.

- [Risk: pg_class / pg_policies query is fragile if Postgres internals change]
  → Mitigation: `pg_class.relrowsecurity` and `pg_policies` are stable catalog views since Postgres 9.5.
  The spec uses only the most stable columns.

## Planner Notes

Self-approved: no new external dependencies; migrations are additive; test uses existing
EmbeddedPostgres pattern. No architectural change. No API change.
