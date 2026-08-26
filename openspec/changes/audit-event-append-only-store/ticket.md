# HEL-471: Audit event model + append-only event store (actor, action, resource, source, timestamp)

## Description

There is no record of who did what to which resource. With multiple users and PAT/MCP agents acting (`AuthDirectives` resolves either a `helio_session` cookie or a `helio_pat_` bearer token), we need a security audit trail. This ticket lays the foundation: the domain model, the append-only store, and the write path — instrumentation of specific routes and the query UI are separate tickets.

## Scope

* New Flyway migration creating an `audit_events` table: `id`, `actor_user_id` (UUID, nullable for pre-auth/system events), `actor_token_id` (nullable, FK-soft to `api_tokens`), `source` (enum text: `ui` / `pat` / `mcp` / `system`), `action` (text, e.g. `dashboard.create`), `resource_type` (text), `resource_id` (text, nullable), `metadata` (jsonb), `created_at` (timestamptz default now()). Index on `(actor_user_id, created_at)` and `(resource_type, resource_id)`.
* Append-only enforcement at the DB layer, so rows are immutable from the application. Follow the existing RLS conventions (`V35`/`V42` owner-style policies via `DbContext`), but note audit reads are admin/owner-scoped — decide and document the policy (owner can read their own audit rows; cross-user reads are out of scope here).
* Domain model (immutable case class with a value-class `AuditEventId`, following the `DashboardId`/`PanelId` pattern) and an `AuditEventRepository` (Slick) with `append(...)` and a basic `findByActor`/`findByResource` for the later query ticket. No inline fully-qualified names.
* A thin `AuditService` (or equivalent) exposing `record(actor, source, action, resourceType, resourceId, metadata)` returning `Future[Unit]`, written fire-and-forget style so the audit write never blocks or fails the primary request path (log on failure). Wire construction in `HttpServer`/`Main`.
* `JsonProtocols` formatters for any response type needed by the query ticket (can be minimal here).

## Acceptance criteria

* Migration applies cleanly; `audit_events` exists with the columns/indexes above.
* **The store is provably append-only: an UPDATE and a DELETE against `audit_events` must FAIL LOUDLY (raise a database error), not silently affect zero rows.** This must hold for the app pool (`DbContext.withUserContext`) AND be explicitly reasoned about for the privileged pool (`DbContext.withSystemContext`, `helio_privileged`, BYPASSRLS, granted UPDATE/DELETE on all tables by V38); design.md must state and justify the chosen posture for both.
* `AuditService.record(...)` inserts a row with correct actor/source/action/resource; a failing insert does not propagate to the caller (unit test with a failing repo stub).
* ScalaTest coverage for the repository append + lookups; `sbt compile test` green.

## Evidence requirements (binding — from the delivery brief)

* **Append-only is a claim that must be DEMONSTRATED, not asserted.** A test that inserts and reads back does not prove append-only. Required evidence: a test that issues an UPDATE and a test that issues a DELETE against `audit_events` and asserts the operation FAILS, plus a captured transcript showing that assertion genuinely failing (red) against a variant without the enforcement — a check that cannot fail is not evidence.
* A silent zero-row UPDATE/DELETE (the natural outcome of RLS-only enforcement under FORCE ROW LEVEL SECURITY with no permissive UPDATE/DELETE policy) does **not** satisfy this criterion. Enforcement must produce an error.
* Every regression test must be verified FAILING against pre-feature code, not merely passing after.

## Reconciliation findings (verified against origin/main 666da5d7 before planning)

* No audit/event-store code exists in the backend. `AuditEvent`, `audit_events`, `AuditService`, `EventStore` return zero hits. V74's `pipeline_runs.triggered_by_token_id` is a single narrow attribution column, not a store.
* **The ticket's "main at V59" is stale.** Max migration on origin/main is `V90__invite_codes.sql`. Re-check the max V-number against origin/main immediately before writing the migration — all worktrees share one dev Postgres and a stale migration from a parallel run has poisoned `flyway_schema_history` before.
* **Enforcement hazard the original ticket text understates:** the app pool connects as `DB_USER`, which OWNS the tables (which is why V35 needs `FORCE ROW LEVEL SECURITY`), and V38 grants `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` — plus `ALTER DEFAULT PRIVILEGES` covering future tables — to `helio_privileged` (BYPASSRLS). A grant-only or RLS-only approach therefore does not deliver a loud failure on both pools. Consider a `BEFORE UPDATE OR DELETE` trigger raising an exception, and/or a `RULE`, in combination with revokes; state the trade-off explicitly.
* **Relationship to HEL-495 (immediately prior ticket, shipped):** its future rate-limit "trip events" are a plausible producer for this store. The model as specified already expresses one (`source=system`, `action=ratelimit.trip`, actor columns carrying the throttled principal, `metadata` jsonb for limit/window). **Decision for this ticket: accommodate by MODEL SHAPE ONLY and stay otherwise ignorant of it** — no import of, dependency on, or instrumentation of `RateLimitDirective`; instrumentation is explicitly out of scope. design.md must state this so the query/instrumentation tickets inherit a model that already fits.

## Out of scope

* Instrumenting actual mutation routes (separate ticket).
* PAT/agent attribution wiring beyond the columns existing (separate ticket).
* Query API + UI (separate ticket).
* Retention/pruning of audit rows (Data Retention epic, HEL-438).
