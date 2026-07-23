# alert-event-api Specification

## Purpose
REST contract for `/api/alerts` (list/get/acknowledge/snooze/resolve) that lets owners read and
drive the lifecycle of their alert events.
## Requirements
### Requirement: List alert events
The backend SHALL expose `GET /api/alerts` returning the authenticated user's alert events as
`{ "items": [...] }`, optionally filtered by `?state=` (`firing`/`resolved`/`acknowledged`/
`snoozed`). A `state=firing` filter SHALL include `snoozed` events whose `snoozedUntil` has passed.

#### Scenario: Empty list
- **WHEN** `GET /api/alerts` is called and the user has no events
- **THEN** the response is 200 with `{ "items": [] }`

#### Scenario: Returns only the caller's events
- **WHEN** `GET /api/alerts` is called and events exist for the caller and for other users
- **THEN** the response includes only events owned by the calling user

#### Scenario: Filters by state
- **WHEN** `GET /api/alerts?state=resolved` is called
- **THEN** the response includes only the caller's events with `state = resolved`

### Requirement: Get single alert event
The backend SHALL expose `GET /api/alerts/:id` returning the full event if owned by the caller.

#### Scenario: Found and owned
- **WHEN** `GET /api/alerts/:id` is called for an event owned by the caller
- **THEN** the response is 200 with the full event

#### Scenario: Not found
- **WHEN** `GET /api/alerts/:id` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Owned by another user
- **WHEN** `GET /api/alerts/:id` is called for an event owned by a different user
- **THEN** the response is 404 (existence not leaked)

### Requirement: Acknowledge alert event
The backend SHALL expose `POST /api/alerts/:id/acknowledge`, owner-scoped, applying the
`Acknowledge` transition.

#### Scenario: Successful acknowledge
- **WHEN** `POST /api/alerts/:id/acknowledge` is called for a `firing` event owned by the caller
- **THEN** the response is 200 with `state = acknowledged` and `acknowledgedAt` set

#### Scenario: Illegal transition rejected
- **WHEN** `POST /api/alerts/:id/acknowledge` is called for a `resolved` event owned by the caller
- **THEN** the response is 409 and the event is unchanged

#### Scenario: Cross-user acknowledge rejected
- **WHEN** `POST /api/alerts/:id/acknowledge` is called for an event owned by a different user
- **THEN** the response is 403 or 404 and no mutation occurs

### Requirement: Snooze alert event
The backend SHALL expose `POST /api/alerts/:id/snooze` accepting `{ snoozedUntil }`, owner-scoped,
applying the `Snooze` transition.

#### Scenario: Successful snooze
- **WHEN** `POST /api/alerts/:id/snooze` is called with a future `snoozedUntil` for a `firing`
  event owned by the caller
- **THEN** the response is 200 with `state = snoozed` and `snoozedUntil` set to the provided value

#### Scenario: Illegal transition rejected
- **WHEN** `POST /api/alerts/:id/snooze` is called for a `resolved` event owned by the caller
- **THEN** the response is 409 and the event is unchanged

#### Scenario: Cross-user snooze rejected
- **WHEN** `POST /api/alerts/:id/snooze` is called for an event owned by a different user
- **THEN** the response is 403 or 404 and no mutation occurs

### Requirement: Resolve alert event
The backend SHALL expose `POST /api/alerts/:id/resolve`, owner-scoped, applying the `Resolve`
transition.

#### Scenario: Successful resolve
- **WHEN** `POST /api/alerts/:id/resolve` is called for a `firing` or `acknowledged` event owned
  by the caller
- **THEN** the response is 200 with `state = resolved` and `resolvedAt` set

#### Scenario: Illegal transition rejected
- **WHEN** `POST /api/alerts/:id/resolve` is called for an already-`resolved` event owned by the
  caller
- **THEN** the response is 409 and the event is unchanged

#### Scenario: Cross-user resolve rejected
- **WHEN** `POST /api/alerts/:id/resolve` is called for an event owned by a different user
- **THEN** the response is 403 or 404 and no mutation occurs

