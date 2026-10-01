## 1. Backend
- [x] 1.1 Red-first: tests asserting free and beta get 403 (on main the route is absent so it is a 404; stub the route to show the red), owner 200
- [x] 1.2 Read-only repository over the rollup tables + `rolled_through`; document role/pool in design.md
- [x] 1.3 Service assembling aggregates (signups, TTFD, funnel, templates, provenance opens, DAU/WAU)
- [x] 1.4 `GET /api/admin/usage` route with server-side owner gate, wired in ApiRoutes
- [x] 1.5 Seeded-events test via real write path + real rollup; exact numbers asserted
- [x] 1.7 Contract delta: response schema in schemas/, JsonProtocols formatters, OpenAPI entry (schema-drift check passes); `days` validation tests (400 non-numeric/out-of-range); empty-rollup test
- [x] 1.6 Non-BYPASSRLS role test proving the read path (and V114 GRANT only if proven needed)

## 2. Frontend
- [x] 2.1 Service + state for the usage endpoint
- [x] 2.2 Admin usage page with charts (existing chart components), TTFD new-users-only label, data-through date
- [x] 2.3 Route + owner-only nav entry (hidden and unroutable for non-owners); tests
- [x] 2.4 a11y (text alternatives), DESIGN.md compliance, both themes, desktop and phone widths

## 3. Verification
- [x] 3.1 All gates (lint, typecheck, prettier, jest, sbt test); record known flakes verbatim
- [ ] 3.2 Live run in both themes with real seeded data; dev-DB cleanup via normal deletes, residue listed (live run DONE both themes/widths; dev-DB cleanup BLOCKED by permission classifier, residue listed in report)
- [x] 3.3 Keep files-modified.md complete

## Standing Constraints
- [C1] Seeded-events AC must exercise the real write path (POST /api/events / ProductEventService + server-side signup) and real rollup code; never hand-inserted rollup rows.
- [C2] Dev-DB hygiene: test users/events created by exact id and removed by normal deletes before Phase 4; never bypass triggers/FKs (no session_replication_role, no DISABLE TRIGGER); list residue if a delete is blocked; do not touch ~/.helio/uploads.
- [C3] Owner-only is a server-side gate (free and beta 403); red-first evidence required; read path proven under a non-BYPASSRLS role.
