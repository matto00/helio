## Why

`WorkspaceTeardownService.teardown` is the highest-blast-radius mutation in the route tree — a
tag-scoped bulk delete of data sources, pipelines, and data types in one transaction — and has zero
audit trail today. HEL-477 instrumented every other named mutation but explicitly deferred this one
(`route-audit-enumeration.md` item 3). An audit log whose blind spot is bulk deletion misses the
case auditing exists for.

## What Changes

- Add a private fire-and-forget `audit(...)` helper to `WorkspaceTeardownService`, mirroring
  `DashboardService`'s pattern, with `auditService: AuditService = null` defaulted in the
  constructor (no-op when null).
- Emit exactly one `workspace.teardown` audit event, only for a **committed** teardown — never for
  a `dryRun` or a `blocked` call, since neither deletes anything (Decision documented in design.md).
- The event's `resourceId` is the tag; `metadata` carries `sourcesDeleted`, `pipelinesDeleted`,
  `typesDeleted`.
- Wire `auditService` through `ApiRoutes` at the `workspaceTeardownServiceOpt` construction site
  (~line 422), preserving the existing null-default no-op path for any other construction.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `audit-mutation-instrumentation`: adds the workspace-teardown bulk-delete requirement — one
  audit row per committed teardown call, none for dry-run/blocked, per the composite-mutation
  "one row per actor-initiated call" principle already established for `dashboard.duplicate` etc.

## Impact

- `backend/src/main/scala/com/helio/services/workspace/WorkspaceTeardownService.scala` — add
  `auditService` param + `audit(...)` helper + call site.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — pass `auditService` at the
  `workspaceTeardownServiceOpt` construction site.
- New/extended integration test coverage asserting exactly-one-row for committed, zero rows for
  dry-run/blocked.

## Non-goals

- `DataSourceService.refresh`, `SourceService.refresh`, `AuthService.completeOAuth` (HEL-840) —
  explicitly out of scope, not touched here.
