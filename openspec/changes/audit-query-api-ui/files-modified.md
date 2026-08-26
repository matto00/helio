## Backend

- `backend/src/main/scala/com/helio/infrastructure/persistence/audit/AuditEventRepository.scala` — adds `AuditEventFilters` and `findPaged(callerUserId, filters, page)`, owner-scoped via `ctx.withUserContext(callerUserId.value)` with an explicit `actorUserId === callerUuid` filter as defense-in-depth (never `withSystemContext`); sort `created_at DESC, id DESC` for deterministic paging.
- `backend/src/main/scala/com/helio/api/routes/audit/AuditEventRoutes.scala` (new) — thin HTTP shell for `GET /api/audit-events`: parses `offset`/`limit`/filters, 400s on malformed `from`/`to`/`source`, passes `user.id` (never a client value) as `callerUserId`.
- `backend/src/main/scala/com/helio/api/protocols/PaginationProtocol.scala` — adds `PagedResult[AuditEventResponse]` JSON format.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `AuditEventRoutes` into the authenticated route tree via the existing `.fold(reject)`-gated optional-wiring pattern (`auditEventRepoOpt`).
- `backend/src/test/scala/com/helio/infrastructure/persistence/audit/AuditEventRepositorySpec.scala` — adds `findPaged` coverage on the real non-BYPASSRLS `helio_app_test`/`helio_privileged` two-role harness (task 1.3): tenant isolation, empty-for-caller-with-no-events, AND-composed filters, deterministic paging/tiebreak. Round-2: adds a raw-SQL `ctx.withUserContext` probe (mirrors `findByActor`'s divergent-filter test) that bypasses `findPaged`'s Scala-level `actorUserId === callerUuid` filter entirely, proving RLS alone (not the app-level clause) scopes another user's row to empty — confirmed to fail red when the probe's `withUserContext` is swapped for `withSystemContext`.
- `backend/src/test/scala/com/helio/api/routes/audit/AuditEventRoutesSpec.scala` (new) — HTTP-layer coverage: two-user cross-visibility, pagination, each filter, malformed-input 400s, limit clamp, negative-offset 400.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — adds the 401-without-Authorization case for `GET /api/audit-events` in the composed route tree (where that behavior actually lives, per `AuthDirectives.authenticate`).

## Schema / spec

- `schemas/audit/audit-event-response.schema.json` (new) — wire contract for `AuditEventResponse`, checked by `npm run check:schemas` against the case class.
- `openspec/changes/audit-query-api-ui/` — proposal/design/tasks/specs (already present from planning); `tasks.md` checkboxes marked complete by this change.

## Frontend

- `frontend/src/features/audit/types/auditEvent.ts` (new) — `AuditEvent`/`AuditSource`/`AuditEventFilters` types mirroring the backend wire shape.
- `frontend/src/features/audit/services/auditEventService.ts` (new) — `fetchAuditEvents` axios call.
- `frontend/src/features/audit/state/auditEventsSlice.ts` (new) — `createAsyncThunk` + slice, loading/error/empty states, v1 first-page-only fetch.
- `frontend/src/features/audit/state/auditEventsSlice.test.ts` (new) — reducer + thunk tests (success, error, empty, non-axios-error fallback).
- `frontend/src/features/audit/ui/actionLabels.ts` (new) — static action→label map informed by `route-audit-enumeration.md`, raw-string fallback for unmapped actions.
- `frontend/src/features/audit/ui/actorLabel.ts` (new) — source→"actor" label mapping (design.md Decision 6a); never infers "MCP" from a `pat` row.
- `frontend/src/features/audit/ui/AuditEventTable.tsx` + `.css` (new) — presentational, read-only table (DESIGN.md tokens); no mutation controls.
- `frontend/src/features/audit/ui/AuditHistorySection.tsx` + `.css` (new) — settings-page section: own fetch/loading/error/empty state, truncation caption (design.md Decision 6b). Round-2: empty state now uses the shared `EmptyState` component (per DESIGN.md, matching `AgentMemoryList.tsx`'s pattern) instead of a hand-rolled `<p>`.
- `frontend/src/features/audit/ui/AuditHistorySection.test.tsx` (new) — loading/empty/error/render/truncation/no-mutation-controls coverage; updated empty-state assertion for `EmptyState`'s rendered title text.
- `frontend/src/features/settings/ui/SettingsPage.tsx` — mounts `AuditHistorySection` as a new "Audit history" section.
- `frontend/src/features/settings/ui/SettingsPage.test.tsx` — mocks `auditEventService.fetchAuditEvents` (house pattern: every mounted section's service call is mocked).
- `frontend/src/store/store.ts` — registers `auditEventsReducer`.
- `frontend/src/test/renderWithStore.tsx` — registers `auditEventsReducer` in the shared test store.
