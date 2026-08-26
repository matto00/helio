# audit-query-api Specification

## Purpose
Provides an authenticated, strictly owner-scoped, paginated and filterable read endpoint over the append-only `audit_events` store, so a caller can review the security-relevant actions recorded against their own account.

## Requirements

### Requirement: Owner-scoped audit event listing
The system SHALL expose `GET /api/audit-events` in the authenticated route tree. The response SHALL contain only audit events whose `actor_user_id` equals the authenticated caller's user id. The system SHALL NOT accept any request parameter that widens visibility to another user's events, and SHALL enforce this scoping via the database RLS owner policy (row-level security applied with the caller's own id as the session context), not solely in application code.

#### Scenario: Caller sees only their own events
- **WHEN** an authenticated user with existing audit events calls `GET /api/audit-events`
- **THEN** every returned event's actor is the calling user

#### Scenario: Another user's events are never returned
- **GIVEN** two authenticated users, each with their own audit events
- **WHEN** user A calls `GET /api/audit-events`
- **THEN** none of user B's events appear in the response, regardless of any filter parameter supplied

#### Scenario: Unauthenticated request is rejected
- **WHEN** a request to `GET /api/audit-events` carries no valid session or PAT credential
- **THEN** the system responds with 401 Unauthorized and no audit rows are returned

### Requirement: Pagination
The system SHALL paginate results using the existing `offset`/`limit` convention (`Page`/`PagedResult`), including the existing maximum-limit clamp, and SHALL report the total matching row count. Results SHALL be ordered by creation time descending with a deterministic tiebreak on id, so that no page-boundary can skip or duplicate a row when multiple events share the same timestamp.

#### Scenario: Stable ordering across pages
- **WHEN** two or more of the caller's events share an identical `created_at` timestamp
- **THEN** repeated requests with the same filters return those events in the same relative order across pages, with no row omitted or duplicated between consecutive pages

#### Scenario: Default page size applies
- **WHEN** a caller requests `GET /api/audit-events` with no `offset`/`limit` supplied
- **THEN** the system applies the existing default page size and returns a `PagedResult` envelope

#### Scenario: Limit is clamped
- **WHEN** a caller requests a `limit` above the existing maximum
- **THEN** the system clamps to the existing maximum rather than erroring

### Requirement: Optional filters
The system SHALL support optional `resourceType`, `resourceId`, `action`, `source`, and time-range (`from`/`to`) query parameters, applied in addition to (never instead of) the owner scope. Omitted filters SHALL impose no additional restriction.

#### Scenario: Filtering by resource
- **WHEN** a caller supplies `resourceType` and `resourceId`
- **THEN** only the caller's own events matching that resource are returned

#### Scenario: Filtering by time range
- **WHEN** a caller supplies `from` and/or `to`
- **THEN** only the caller's own events with `created_at` inside the supplied range are returned

#### Scenario: Invalid filter value is rejected, not silently ignored
- **WHEN** a caller supplies a malformed `from`/`to` timestamp or an unrecognized `source` value
- **THEN** the system responds with 400 Bad Request describing the invalid parameter
