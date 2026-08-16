# Files modified — HEL-531 (agent-memory-privacy-controls)

## Backend — main

- `backend/src/main/scala/com/helio/domain/model.scala` — `AgentPreferences` gains
  `memoryEnabled: Boolean`; `AgentPreferences.empty(userId, memoryEnabled)` takes it as an
  explicit parameter (domain stays pure, no `sys.env`).
- `backend/src/main/scala/com/helio/services/AgentPreferencesService.scala` — new
  `DefaultMemoryEnabled` env-var-overridable constant (`AGENT_MEMORY_DEFAULT_ENABLED`, default
  `true`); `get` passes it into `AgentPreferences.empty`; `put` now reads current preferences
  first and carries `memoryEnabled` forward unchanged before overlaying the request's four
  fields (design.md Decision 2, the crux of the ticket); new `setMemoryEnabled(user, enabled)`.
- `backend/src/main/scala/com/helio/infrastructure/AgentPreferencesRepository.scala` —
  `domainToRow`/`rowToDomain` (de)serialize `memoryEnabled` into the existing `preferences`
  JSONB blob; absent-on-decode falls back to `true` (a pre-ticket row never had this key).
- `backend/src/main/scala/com/helio/api/protocols/AgentPreferencesProtocol.scala` —
  `AgentPreferencesResponse` gains `memoryEnabled`; new `PutMemoryEnabledRequest` wire type +
  formatters.
- `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` —
  `WorkspaceContextAgentSection.empty`'s literal `AgentPreferencesResponse` updated for the new
  field (hardcoded `true`, documented why).
- `backend/src/main/scala/com/helio/api/routes/AgentPreferencesRoutes.scala` — new
  `PUT /api/preferences/memory-enabled` route, delegating to `setMemoryEnabled`; kept fully
  separate from the existing `PUT /api/preferences` route (design.md Decision 1).
- `backend/src/main/scala/com/helio/services/AgentMemoryService.scala` — new
  `AgentPreferencesService` dependency; `add` checks `memoryEnabled` after existing validation,
  no-ops (constructed-but-never-persisted entry, still success) when `false`; new
  env-var-overridable `RetentionDays` constant (`AGENT_MEMORY_RETENTION_DAYS`, default `90`)
  threaded into the repository as an explicit parameter.
- `backend/src/main/scala/com/helio/infrastructure/AgentMemoryRepository.scala` — new private
  `pruneExpired(ownerUuid, retentionDays)` helper; `add`/`list` both prune before running their
  main query, under the same `withUserContext` action.
- `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` —
  `buildAgentContext` skips `memoryService.list`/`touch` entirely when the already-fetched
  `preferences.memoryEnabled` is `false`, still including `preferences` in the response.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `agentMemoryServiceOpt` now also
  requires `agentPreferencesServiceOpt` (a `for`-comprehension over both `Option`s) to satisfy
  `AgentMemoryService`'s new constructor dependency.

## Schemas

- `schemas/agent-preferences.schema.json` — `memoryEnabled` added to `AgentPreferencesResponse`'s
  properties/required.
- `schemas/put-memory-enabled-request.schema.json` — new schema for `PutMemoryEnabledRequest`.
- `schemas/workspace-context.schema.json` — its self-contained, duplicated `AgentPreferences`
  `$def` (not `$ref`'d cross-file, per that file's own convention) also needed `memoryEnabled`
  added; caught by `WorkspaceContextServiceSpec`'s schema-validity tests failing against a live
  response that now carries the field (root cause: this second copy of the shape, not tracked by
  `check-schema-drift.mjs`, which only checks `schemas/agent-preferences.schema.json`).

## Backend — tests

- `backend/src/test/scala/com/helio/services/AgentPreferencesServiceSpec.scala` — default-true
  `get`, `put`-preserves-`memoryEnabled`, `setMemoryEnabled` round-trip coverage (task 5.1).
- `backend/src/test/scala/com/helio/services/AgentMemoryServiceSpec.scala` — `add` no-op when
  disabled / normal when enabled (task 5.2); now wires an `AgentPreferencesService` collaborator.
- `backend/src/test/scala/com/helio/infrastructure/AgentMemoryRepositorySpec.scala` — new
  retention coverage: over-age excluded + deleted, within-window unaffected, prune-before-cap,
  touch-does-not-extend-retention (task 5.3); existing `add`/`list` call sites threaded a
  `NoPruning` retention constant so pre-existing cap-and-evict tests are unaffected.
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceAgentContextSpec.scala` —
  new "empty memory when disabled, preferences still populated" coverage (task 5.4); pre-existing
  ranking/touch tests' `base` timestamps switched from hardcoded 2026-01/02 calendar dates to
  `Instant.now()`-relative (the new 90-day retention default would otherwise prune them, since
  those hardcoded dates are now outside the window relative to the current date).
- `backend/src/test/scala/com/helio/api/routes/AgentMemoryRoutesSpec.scala` — new
  GET/DELETE-unaffected-by-`memoryEnabled` coverage (task 5.5); now wires an
  `AgentPreferencesService` collaborator.
- `backend/src/test/scala/com/helio/api/routes/AgentPreferencesRoutesSpec.scala` — new
  opt-out/opt-in coverage for `PUT /preferences/memory-enabled`, and a route-level test proving
  `PUT /preferences` doesn't reset a previously-set `memoryEnabled` (task 5.6).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new composed-route-tree 401 test
  for `PUT /api/preferences/memory-enabled` without Authorization, mirroring the existing
  `/api/preferences` 401 tests.
- `backend/src/test/scala/com/helio/infrastructure/AgentPreferencesRepositorySpec.scala` —
  existing `AgentPreferences(...)` literals gained `memoryEnabled`; new
  decode-absent-key-as-true regression test (a raw-SQL-inserted pre-ticket-shaped row).
- `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` — `seedAgentPreferences`
  helper's `AgentPreferences(...)` literal gained `memoryEnabled`; `seedAgentMemory`'s
  `agentMemoryRepo.add` call threaded a `retentionDays` argument.
- `backend/src/test/scala/com/helio/services/DashboardAuthoringPromptSpec.scala` — existing
  `AgentPreferencesResponse(...)` literals gained `memoryEnabled` (unrelated to this ticket's own
  behavior, purely a compile fix for the new required field).
