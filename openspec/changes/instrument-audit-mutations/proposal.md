## Why

HEL-471 shipped an append-only audit store and `AuditService.record(...)`, but nothing calls it —
`Main.scala` constructs `auditService` with zero consumers. Security-relevant mutations and auth
events are currently invisible to any audit trail.

## What Changes

- Thread `AuditService` into the service layer for dashboards, panels, pipelines (+ steps/runs
  submit), data sources, and data types: one `record(...)` call per create/update/delete, keyed
  off a stable `<resource>.<verb>` action namespace.
- Thread `AuditService` into `AuthService` (register/login incl. failed/logout) and
  `ApiTokenService` (create/revoke), emitting `auth.*`/`token.*` actions. Failed login captures the
  attempted identifier in `metadata`, never a password.
- Every call site fires the audit write after the underlying mutation succeeds and does not gate
  the response on it — `AuditService.record` already never fails the caller (HEL-471 contract),
  reused as-is, unmodified.
- No new route, no read-path (`GET`) instrumentation, no `source`/`actor_token_id` attribution
  logic (PAT/MCP vs UI stays a later ticket per the original scope note).

## Capabilities

### New Capabilities
- `audit-mutation-instrumentation`: the set of service-layer call sites that must call
  `AuditService.record(...)` on each state-changing mutation and auth event, with the
  action/resource-type/resource-id/metadata contract each site follows.

### Modified Capabilities
(none — `AuditService.record`'s own contract, owned by `audit-event-recording`, is unchanged;
this change only adds callers.)

## Impact

- `backend/src/main/scala/com/helio/services/{dashboards,panels,pipelines,sources,auth}/*.scala`
  (constructor now takes `AuditService`).
- `backend/src/main/scala/com/helio/app/Main.scala` (wires `auditService` into each constructor).
- Existing unit/integration tests for the above services (constructor signature change).
- New integration tests asserting one audit row per mutation and audit-failure isolation.

## Non-goals

- The audit store/model itself (HEL-471, already shipped).
- `source`/`actor_token_id` attribution across UI vs PAT vs MCP (separate ticket).
- Any query API or UI surface for audit events.
- Read/GET traffic instrumentation.
