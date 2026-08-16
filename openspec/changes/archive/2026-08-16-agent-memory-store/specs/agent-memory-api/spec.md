## ADDED Requirements

### Requirement: GET /api/agent/memory lists the caller's memory entries
The backend SHALL expose `GET /api/agent/memory` on the authenticated route tree, returning the
caller's stored memory entries.

#### Scenario: Authenticated user with stored entries
- **WHEN** a client sends `GET /api/agent/memory` with a valid session token
- **AND** the user has stored memory entries
- **THEN** the response is HTTP 200 with the caller's entries

#### Scenario: Authenticated user with no stored entries
- **WHEN** a client sends `GET /api/agent/memory` with a valid session token
- **AND** the user has no stored memory entries
- **THEN** the response is HTTP 200 with an empty list

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `GET /api/agent/memory` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

### Requirement: POST /api/agent/memory creates a memory entry
The backend SHALL expose `POST /api/agent/memory` on the authenticated route tree, accepting a
`kind` (one of `fact`/`goal`/`preference-note`) and free-text `content`, persisting a new entry
for the caller, and returning HTTP 201 with the created entry.

#### Scenario: Valid creation request
- **WHEN** a client sends `POST /api/agent/memory` with a valid session token and a body with a
  valid `kind` and non-empty `content`
- **THEN** the backend persists a new entry owned by the caller
- **AND** returns HTTP 201 with the created entry

#### Scenario: Invalid kind is rejected
- **WHEN** a client sends `POST /api/agent/memory` with a `kind` not in
  `fact`/`goal`/`preference-note`
- **THEN** the backend returns HTTP 400 Bad Request and does not persist an entry

#### Scenario: Blank content is rejected
- **WHEN** a client sends `POST /api/agent/memory` with a valid `kind` and blank (empty or
  whitespace-only) `content`
- **THEN** the backend returns HTTP 400 Bad Request and does not persist an entry

#### Scenario: Creating past the per-user cap evicts the least-recently-useful entry
- **WHEN** a client sends `POST /api/agent/memory` for a user who already has 100 entries
- **THEN** the backend persists the new entry
- **AND** the least-recently-useful existing entry is evicted, per
  `agent-memory-persistence`'s eviction requirement
- **AND** the response is still HTTP 201 with the newly created entry

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `POST /api/agent/memory` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

### Requirement: DELETE /api/agent/memory/:id removes one entry
The backend SHALL expose `DELETE /api/agent/memory/:id` on the authenticated route tree,
removing the specified entry if owned by the caller.

#### Scenario: Deleting a caller-owned entry
- **WHEN** a client sends `DELETE /api/agent/memory/:id` for an entry owned by the caller
- **THEN** the entry is removed
- **AND** the response is HTTP 204 No Content

#### Scenario: Deleting an unknown or another user's entry
- **WHEN** a client sends `DELETE /api/agent/memory/:id` for an id that does not exist, or
  belongs to another user
- **THEN** no entry is removed
- **AND** the response is HTTP 404 Not Found

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `DELETE /api/agent/memory/:id` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

### Requirement: DELETE /api/agent/memory clears all of the caller's entries
The backend SHALL expose `DELETE /api/agent/memory` (no id segment) on the authenticated route
tree, removing every entry owned by the caller.

#### Scenario: Clearing a non-empty memory
- **WHEN** a client sends `DELETE /api/agent/memory` for a user with stored entries
- **THEN** all of the caller's entries are removed
- **AND** the response is HTTP 204 No Content

#### Scenario: Clearing an already-empty memory
- **WHEN** a client sends `DELETE /api/agent/memory` for a user with no stored entries
- **THEN** the response is still HTTP 204 No Content (not an error)

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `DELETE /api/agent/memory` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized
