# HEL-477: Instrument create/update/delete mutations and auth events into the audit store

## Description

With the audit store and `AuditService` in place, the security-relevant mutations need to actually emit events. Mutations flow through the service layer behind the route files in `backend/src/main/scala/com/helio/api/routes/` (DashboardRoutes, PanelRoutes, PipelineRoutes, PipelineStepRoutes, SourceRoutes/DataSourceRoutes, DataTypeRoutes) and auth handlers (AuthRoutes register/login/logout, ApiTokenRoutes create/revoke, OAuthRoutes).

## Scope

* Emit an audit event on each state-changing operation: create/update/delete of dashboards, panels, pipelines (+ steps/runs submit), data sources, and data types. Prefer instrumenting at the service layer (single call site per operation) over per-route so both UI and PAT/MCP callers are covered uniformly.
* Emit auth events: successful + failed login, register, logout, PAT create, PAT revoke. For failed login, actor_user_id may be null; capture the attempted identifier in `metadata` without storing secrets.
* Populate `action` with a stable verb namespace (e.g. `dashboard.create`, `panel.delete`, `auth.login.failed`, `token.revoke`) and `resource_type`/`resource_id` from the affected entity.
* Do not audit read/GET traffic (volume + no security value here); scope strictly to mutations + auth.

## Acceptance Criteria

* Performing each mutation via API writes exactly one audit row with correct action/resource/actor (integration tests using the route testkit + a real/embedded audit repo).
* A failed login writes an `auth.login.failed` row with no plaintext password/secret in `metadata`.
* Audit write failures never fail the underlying request (asserted with a failing audit stub).
* `sbt compile test` green.

## Out of Scope

* The audit store/model itself (separate ticket — this depends on it; shipped as HEL-471).
* Distinguishing UI vs PAT vs MCP `source` values (separate attribution ticket).
* Query API + UI.

## Dependencies

Depends on the audit event store/model ticket (HEL-471, merged c0d4679b). Pairs with the PAT/agent attribution ticket (which fills in the `source`/`actor_token_id` values these call sites pass).

## Ground truth notes (verified against origin/main@18e00ba5, not ticket prose)

* HEL-471's append-only enforcement is BEFORE UPDATE OR DELETE + BEFORE TRUNCATE triggers raising SQLSTATE 23001 — NOT the grant-revoke approach older ticket text elsewhere in the epic speculated about. This ticket does not touch that mechanism.
* `AuditService.scala` (backend/src/main/scala/com/helio/services/audit/AuditService.scala) and `AuditEventRepository.scala` already exist and are wired into `Main.scala` with no consumer yet.
