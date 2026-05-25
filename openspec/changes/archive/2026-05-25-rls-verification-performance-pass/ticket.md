# HEL-277: RLS Verification + Performance Pass

## Title
RLS verification + performance pass

## Description

Final sub-ticket for HEL-272. Closes the epic by proving the implementation is correct, performant, and survives the failure modes we care about.

Blocked by: HEL-273, HEL-274, HEL-275, HEL-276 — all policy work must be in place.

## Why a dedicated verification ticket

RLS is a **defense-in-depth** control. The failure mode if we get it wrong (silent cross-tenant data leak via pooled connection state) is severe enough that a dedicated verification pass with explicit adversarial tests is worth the cost. The HEL-265 app-layer test suite proves the app code works; this ticket proves the database layer itself enforces.

## Verification matrix

### Correctness — fail-closed behavior

- [ ] Connect with NO `SET LOCAL app.current_user_id` → every ACL'd table returns 0 rows on SELECT
- [ ] Connect, `SET LOCAL` to user A, run query, return connection to pool; pull a fresh connection, query WITHOUT `SET LOCAL` → 0 rows (proves no session-var bleed)
- [ ] Run the HEL-265 cross-user test matrix unchanged — every test still passes with RLS layered on top
- [ ] Run the dashboard-sharing test suite unchanged — owner / editor grantee / viewer grantee / public-viewer / no-grant all behave correctly

### Correctness — privileged paths

- [ ] `withSystemContext` can read across all users
- [ ] `withUserContext(A)` cannot read user B's rows
- [ ] Forgetting to wrap a query in either context → 0 rows (fail-closed)
- [ ] Audit every `*Internal` callsite from HEL-265 CS2/CS3/CS4 and confirm it routes through `withSystemContext`

### Performance

- [ ] EXPLAIN ANALYZE the dashboard list query — confirm index scan, not seq scan
- [ ] EXPLAIN ANALYZE the panel-by-dashboard query — confirm the dashboard ACL JOIN uses the index
- [ ] EXPLAIN ANALYZE the pipeline list, type list, source list queries
- [ ] EXPLAIN ANALYZE the public-viewer dashboard read (anon path)
- [ ] EXPLAIN ANALYZE the sharing-aware dashboard read (grantee path through `resource_permissions`)
- [ ] Seed a dev DB with ~100 dashboards / user across 10 users; measure p50/p95 read latency before and after RLS — flag any regression >10%

### Operational

- [ ] Run a Flyway migration smoke from a fresh DB; confirm the migration succeeds and produces the expected role / policy state
- [ ] Document the `helio_app` vs `helio_privileged` role split in the runbook
- [ ] Add a Grafana / monitoring panel for connection pool metrics on both pools (if Option A from HEL-274 was chosen)

### Code hygiene

- [ ] Update `openspec/changes/repo-acl-enforcement/design.md` to note Q2 (RLS) is now resolved by HEL-272
- [ ] Update `CONTRIBUTING.md` with the `withUserContext` / `withSystemContext` pattern (if not already done in HEL-273)
- [ ] Surface any spinoffs found during verification

## Acceptance criteria

1. Every verification-matrix item above is checked
2. p95 read latency regression ≤10% across the measured hot paths
3. The "session-var bleed" regression test sits in the suite to catch any future infra change that breaks the invariant
4. Documentation (runbook + CONTRIBUTING) reflects the new role split + wrapper pattern
5. HEL-272 epic can be closed

## Out of scope

* Migrating non-ACL'd auxiliary tables to RLS (e.g., `auth_sessions`, `users`) — those don't have an owner concept; out of scope by design
