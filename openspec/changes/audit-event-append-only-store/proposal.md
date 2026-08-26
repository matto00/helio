## Why

Helio has no record of who did what to which resource. Multiple humans and PAT/MCP agents now act on the same
account through `AuthDirectives`, and nothing distinguishes a user's own dashboard deletion from an agent's. This
is the foundation ticket of the Audit Logging epic (HEL-435): it establishes the event model, the durable store,
and the write path, so the later instrumentation, attribution, and query tickets have a stable contract to build on.

## What Changes

- New `audit_events` table (Flyway) recording actor (user and/or PAT token), `source` (`ui`/`pat`/`mcp`/`system`),
  `action`, `resource_type`, `resource_id`, `metadata` (jsonb), and `created_at`, with indexes supporting
  actor-scoped and resource-scoped lookups.
- **Append-only enforcement in the database.** UPDATE and DELETE against `audit_events` raise a database error
  rather than silently affecting zero rows. Enforcement is applied at a layer that neither a re-`GRANT` nor a
  `BYPASSRLS` role can quietly undo, so it holds for the app pool and the privileged pool alike.
- Owner-scoped RLS read policy following `V35`/`V42`'s direct-owner *predicate*, but restricted to
  `FOR SELECT` — the `FOR ALL` shape those migrations use is actively wrong for this table, because it would
  filter rows out of the scan and re-introduce silent no-op mutations; see design.md Decision 3. A user reads
  only audit rows whose `actor_user_id` is their own. Cross-user/admin reads are out of scope.
- New domain model `AuditEvent` with a value-class `AuditEventId`, a Slick `AuditEventRepository`
  (`append`, `findByActor`, `findByResource`), and a thin fire-and-forget `AuditService.record(...)` whose failures
  are logged and never propagate to the caller's request path. Wired in the server's construction root.
- Minimal `JsonProtocols` formatters so the later query ticket does not need to reopen the protocol layer.

## Capabilities

### New Capabilities
- `audit-event-persistence`: the `audit_events` schema, its append-only guarantee, its owner-scoped read policy,
  and the repository contract (`append`, `findByActor`, `findByResource`).
- `audit-event-recording`: the `AuditService.record(...)` write path — its event shape, and its fire-and-forget
  failure-isolation guarantee that an audit write never fails or blocks the primary request.

### Modified Capabilities

(none — no existing requirement changes; no route is instrumented by this change)

## Impact

- New: `audit_events` migration, `AuditEvent`/`AuditEventId` domain model, `AuditEventRepository`, `AuditService`,
  their formatters, and their ScalaTest suites.
- Touched: the server construction root (to build `AuditService`) and `JsonProtocols`.
- Not touched: no route, directive, or existing service gains an audit call in this change. In particular the
  HEL-495 rate-limiting directive is **not** instrumented; the model merely accommodates its future trip events.

## Non-goals

- Instrumenting mutation routes or auth events (separate ticket).
- PAT/agent attribution wiring beyond the columns existing (separate ticket).
- Audit query API and UI (separate ticket).
- Retention/pruning of audit rows (HEL-438, Data Retention epic).
- Cross-user or admin-wide audit reads.
