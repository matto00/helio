## 1. Backend: repository query

- [x] 1.1 Add `AuditEventFilters` (resourceType, resourceId, action, source, from, to — all `Option`) and `AuditEventRepository.findPaged(callerUserId, filters, page)` using `ctx.withUserContext`, mirroring `findByActor`/`findByResource`'s RLS pattern. Include an explicit `actorUserId === callerUuid` filter as defense-in-depth alongside RLS. Sort `ORDER BY created_at DESC, id DESC` (deterministic tiebreak — design.md Decision 1).
- [x] 1.2 Return total count alongside the page (for `PagedResult`), following `PublicDashboardRoutes`'s existing paged-query shape.
- [x] 1.3 `AuditEventRepositorySpec` (or a sibling spec): add a `findPaged` test on the existing non-BYPASSRLS `helio_app_test` role/harness that would fail red if RLS were bypassed — assert the RLS-scoped path returns empty when the context user is B but filters target A's rows, independent of the app-level actor filter's own contribution (skeptic round 1, item 1 — do not rely solely on the route-level test in 2.4 as proof of tenant isolation).

## 2. Backend: route + wire contract

- [x] 2.1 Add `AuditEventResponse` to `JsonProtocols` (id, actorUserId, actorTokenId, source as lowercase wire string, action, resourceType, resourceId, metadata, createdAt).
- [x] 2.2 Add `GET /api/audit-events` in the authenticated route tree (`ApiRoutes`), parsing `offset`/`limit` (existing `Page` convention + `Page.MaxLimit` clamp) and optional `resourceType`/`resourceId`/`action`/`source`/`from`/`to`; 400 on malformed `from`/`to` or unrecognized `source`.
- [x] 2.3 Add `schemas/audit-event*.json` + `openspec/specs/audit-query-api/spec.md` delta artifacts (already drafted in this change's `specs/`) — verify `npm run check:schemas` passes once archived.
- [x] 2.4 Backend integration test: two users, each with audit events; user A's `GET /api/audit-events` never returns user B's rows, with and without filters. Unauthenticated request returns 401. Pagination and each filter individually tested.

## 3. Frontend: state + service

- [x] 3.1 Add a service method (axios) calling `GET /api/audit-events` with query params.
- [x] 3.2 Add a Redux slice (`auditEventsSlice`) with `createAsyncThunk`, loading/error/empty states.
- [x] 3.3 Jest tests for the slice/thunk (success, error, empty).

## 4. Frontend: UI

- [x] 4.1 Presentational table component (DESIGN.md tokens) rendering action/resource/actor(=source)/timestamp, human-readable via a small static action-label map (raw-string fallback for unmapped actions) informed by `route-audit-enumeration.md`. Actor column renders "You (browser)"/"You (API token)"/"System" per source (design.md Decision 6a) — never a raw `actorUserId` UUID; `actorTokenId`, if present, shown only as a secondary monospace detail.
- [x] 4.2 Render `source` values as returned by the API only — never label a `pat` event as "MCP."
- [x] 4.3 Empty state and error state, per spec.
- [x] 4.4 Wire into settings/account area navigation.
- [x] 4.5 First-page-only v1 (design.md Decision 6b): show a static "showing latest N of TOTAL" caption using the response's `total`; no next-page control in this ticket.

## 5. Verification

- [x] 5.1 `sbt compile test` green.
- [x] 5.2 `npm test`, `npm run lint`, `npm run typecheck` green.
- [x] 5.3 `npm run check:schemas` / openspec hygiene checks green.
- [x] 5.4 Manual/UI review against DESIGN.md tokens (evaluator Phase 3 UI Review — this ticket has a real frontend surface, not N/A).
