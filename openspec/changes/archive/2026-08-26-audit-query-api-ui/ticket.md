# HEL-488: Audit query API + minimal read-only UI

## Description

Audit rows are only useful if they can be reviewed. With the store populated, expose a scoped query endpoint and a minimal UI so a user can see the security-relevant actions on their own account/resources.

## Scope

* New authenticated route (e.g. `GET /api/audit-events`) mounted in the authenticated route tree in `ApiRoutes`, backed by `AuditEventRepository`, with pagination following the existing `Page`/`PagedResult` convention (see `PublicDashboardRoutes` offset/limit pattern) and optional filters: `resourceType`, `resourceId`, `action`, `source`, and a time range. Enforce owner-scoping via RLS/`app.current_user_id` so a user only sees their own audit rows.
* `JsonProtocols` response formatter for the audit event response type; schema in `schemas/` + spec in `openspec/` per the API-contract convention.
* Minimal frontend surface: a read-only audit list view (Redux slice + `createAsyncThunk` calling a new service method, presentational table component following `DESIGN.md` tokens). No mutation controls. Reachable from settings/account area.

## Acceptance criteria

* `GET /api/audit-events` returns the caller's audit rows only, paginated, with working filters; another user's rows never appear (integration test with two users).
* Schema/spec added and pass `npm run check:schemas` / openspec hygiene checks.
* Frontend view renders the rows with human-readable action/resource/actor/source/timestamp; Jest test for the slice/thunk; `npm run lint` clean.
* `sbt compile test` and frontend `npm test` green.

## Out of scope

* Cross-user/admin audit views (no admin role exists yet).
* Export of audit data (Data Retention epic's data-export ticket).
* Alerting on audit events.

## Dependencies

Depends on the audit event store ticket (and is more useful after instrumentation lands). HEL-471 (store), HEL-477 (instrumentation), HEL-483 (actor attribution) are all merged to main as of this run.

## Orchestrator briefing (from the human, verified independently before worktree setup)

* **Security is the heart of this ticket.** Tenant isolation is the AC most worth adversarial attention. `AuditEventRepository.findByActor`/`findByResource` already read on `ctx.withUserContext(callerUserId, ...)` (RLS-scoped, NOT the privileged/BYPASSRLS pool) — the new paginated/filtered query method this ticket adds **must** follow that same pattern. Do not use `ctx.withSystemContext` for the new read path; RLS policy `audit_events_owner` (V91) is `FOR SELECT USING (actor_user_id = current_setting('app.current_user_id')::uuid)` and is the enforcement backstop, but the repository must still pass the correct RLS context user (the caller, from `AuthenticatedUser`, never a client-supplied filter value).
* **HEL-483 actor attribution:** `AuthenticatedUser` carries `source`/`tokenId`. UI session → `source=ui`, null token id. `helio_pat_` bearer → `source=pat`, real `actor_token_id`. MCP calls are recorded as `source=pat` (no reliable distinguishing signal) — `AuditSource.Mcp` exists in the DB CHECK constraint (`'mcp'` is a legal value) but is deliberately never written. **Do not present "MCP" as a distinguishable source in the UI** — the data cannot support that distinction honestly.
* **HEL-477 instrumentation map:** read `openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md` for the exhaustive route→action mapping — this tells you what actions/resourceTypes the UI will actually need to render human-readably.
* **Known, deliberate out-of-scope gaps — do not "fix," do not file spinoff tickets for these:** `WorkspaceTeardownService.teardown`'s bulk delete has zero audit trail; `DataSourceService.refresh`/`SourceService.refresh` are unaudited; `AuthService.completeOAuth` does not emit `auth.register` on first-time Google signup.
* **Escalation threshold:** escalate and halt only for infra/deployment/cost decisions. Decide and continue on everything else derivable from DESIGN.md, CONTRIBUTING.md, openspec specs, this ticket's acceptance criteria, or an established pattern in the tree — record the reasoning rather than asking.
