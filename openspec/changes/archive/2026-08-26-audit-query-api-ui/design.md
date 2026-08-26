## Context

`audit_events` (V91) exists with a `FOR SELECT` RLS owner policy (`actor_user_id = current_setting('app.current_user_id')::uuid`). `AuditEventRepository.findByActor`/`findByResource` already read via `ctx.withUserContext(callerUserId, ...)` — RLS-scoped, not the privileged pool — but take no pagination and only single-value resource filters, not the action/source/time-range set this ticket needs. `AuthDirectives` resolves `AuthenticatedUser` with `source`/`tokenId` (HEL-483); `AuditSource` is `Ui | Pat | Mcp | System`, `Mcp` never actually written (MCP calls record as `Pat`). `PublicDashboardRoutes` is the existing `Page`/`PagedResult` offset/limit pattern to follow.

## Goals / Non-Goals

**Goals:**
- Owner-scoped, paginated, filterable read endpoint that can never leak another user's rows, enforced by RLS (not application logic alone).
- Minimal, honest read-only UI — no invented "MCP" distinction the data can't support.

**Non-Goals:**
- Admin/cross-user views, export, alerting (ticket Out of scope).
- Fixing unaudited gaps (`WorkspaceTeardownService.teardown`, `DataSourceService`/`SourceService.refresh`, OAuth first-signup `auth.register`) — deliberately deferred, not this ticket.

## Decisions

**Decision 1 — New repository method, not overload of `findByActor`.** Add `AuditEventRepository.findPaged(callerUserId: UserId, filters: AuditEventFilters, page: Page): Future[PagedResult-shaped tuple]` using `ctx.withUserContext(callerUserId.value)(...)`, mirroring `findByActor`/`findByResource` exactly. `callerUserId` is always the authenticated caller — there is no code path where a filter value substitutes for it, closing the exact hole `findByActor`'s own doc comment warns against. Sort order is `ORDER BY created_at DESC, id DESC` — `created_at` alone is not unique enough to page over safely (multiple rows routinely share a timestamp), so `id` breaks ties deterministically; without this, `offset`/`limit` paging can duplicate or skip rows across pages (skeptic round 1).

**Decision 2 — RLS is the enforcement backstop, not just app-code filtering.** Even though the Slick query could additionally `.filter(_.actorUserId === callerUuid)` at the application layer, the repository does not rely on that alone: the RLS context passed to `withUserContext` is what makes a coding mistake (e.g. an added filter branch that forgets the actor clause) fail closed rather than leak. Both an explicit `WHERE actor_user_id = ?` (defense in depth, matching `findByActor`'s existing shape) and the RLS context are present.

**Decision 3 — Filters compose as AND, never widen scope.** `resourceType`/`resourceId`/`action`/`source`/`from`/`to` are all optional, ANDed together, applied strictly in addition to the RLS-enforced owner scope. None can be used to query another actor's rows — there is no `actorUserId` request parameter at all.

**Decision 4 — Route validation follows existing directive patterns.** `from`/`to` parsed as ISO-8601 instants; malformed values or an unrecognized `source` value reject with 400 (`ErrorResponse`), matching `PublicDashboardRoutes`'s `offsetRaw < 0` 400 pattern. `limit` clamps to `Page.MaxLimit` (existing convention), never errors.

**Decision 5 — Response shape lives in `JsonProtocols` + `schemas/`.** New `AuditEventResponse` case class (id, actorUserId, actorTokenId as optional string ids, source as its lowercase wire string via `AuditSource.asString`, action, resourceType, resourceId, metadata, createdAt as ISO string), formatter added to `JsonProtocols`, JSON Schema added under `schemas/`, matching the existing API-contract convention (schema + openspec spec, not just code).

**Decision 6 — UI never labels an event "MCP."** `source` is rendered directly from the API's wire value (`ui`, `pat`, `system`). `mcp` is a legal wire value per the DB CHECK constraint, but is never actually produced today (confirmed: zero writers of `AuditSource.Mcp` in `backend/src/main/scala`); if it is ever returned the UI renders it generically rather than crashing, but no client-side heuristic infers "MCP" from a `pat` row, since `AuthDirectives` has no signal to distinguish them.

**Decision 6a — "actor" column: no invented human-readable identity; render "You" + source, not a raw UUID.** Every row returned is by construction the caller's own (owner-scoped read), so an "actor" column showing `actorUserId` would always just echo the viewer's own UUID back at them — not human-readable, not useful, and not what the AC means by "actor." Resolved as: the UI does **not** render `actorUserId` at all. It renders **source** (labeled "You (browser)" for `ui`, "You (API token)" for `pat`, "System" for `system`) as the actor-equivalent column the AC's "actor" language refers to. `actorTokenId` is surfaced only as a secondary, monospace detail (its raw id, not a name — no token-name lookup is added; `AuditEventResponse`/schema are unchanged from Decision 5, since no new field is needed for this). This keeps Decision 5's response shape as originally specified.

**Decision 6b — UI pagination: first page only for v1, explicit choice not an omission.** The view renders the first `Page.Default` page (200 rows, newest-first) with no "load more"/next-page control in this ticket. `total` (already in `PagedResult`) is displayed as a static "showing latest N of TOTAL" caption so truncation is visible to the user rather than silent. Full pagination controls are deferred — this is a minimal v1 read surface per the ticket's own "minimal frontend surface" framing, and the caption keeps the truncation honest rather than hidden.

**Decision 7 — Action/resource human-readability uses a small static label map, informed by `route-audit-enumeration.md`.** The frontend maintains a lookup (e.g. `dashboard.create` -> "Created dashboard") covering the actions enumerated in the HEL-477 archived evidence; an unmapped action falls back to rendering the raw action string verbatim (fail-open to raw string, never fail-closed to a blank row) so a future instrumented action doesn't silently disappear from the UI.

**Decision 8 — Placement: settings/account area.** Reachable as a new route/tab alongside existing account/settings UI (mirrors how other account-scoped, non-dashboard views are already reached), per the ticket's "Reachable from settings/account area."

## Planner Notes

Self-approved: capability split into `audit-query-api` (backend) and `audit-events-ui` (frontend) rather than one combined capability, matching this repo's existing pattern of separate spec files per layer for a single ticket (e.g. HEL-483's actor-attribution spec is backend-only; this ticket is the first with both layers, so two capabilities keeps each spec's scenarios testable independently). Time-range filter uses `from`/`to` query param names (not `startDate`/`endDate`) to match `Instant`-shaped precision already used elsewhere (`createdAt`) rather than date-only granularity.

## Risks / Trade-offs

- Adding an explicit app-level actor filter alongside RLS is technically redundant with a correctly-configured `withUserContext` call, but cheap insurance against a future refactor of `DbContext` weakening the RLS path silently — accepted.
- Static label map (Decision 7) needs manual upkeep as new audit actions ship; mitigated by the raw-string fallback so staleness degrades gracefully rather than hiding data.
