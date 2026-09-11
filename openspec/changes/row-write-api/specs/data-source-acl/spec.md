## MODIFIED Requirements

### Requirement: DELETE /api/data-sources/:id enforces ownership
`DELETE /api/data-sources/:id` SHALL return `404 Not Found` when the source does not exist or belongs
to a different user (existence-not-leaked semantics: a cross-user caller cannot distinguish "does not
exist" from "exists but you cannot access it"). `POST /api/data-sources/:id/rows` and
`PUT /api/data-sources/:id/rows` SHALL enforce the same ownership rule: a non-owner (or a caller
targeting a nonexistent source) receives `404 Not Found`, identical in shape to the response for any
other nonexistent or non-owned source, never revealing whether the source exists.

#### Scenario: Owner can delete their source
- **WHEN** the owner calls `DELETE /api/data-sources/:id`
- **THEN** the source is deleted and the response is `204 No Content`

#### Scenario: Non-owner receives 404 for another user's source
- **WHEN** a non-owner calls `DELETE /api/data-sources/:id` for a source owned by another user
- **THEN** the response is `404 Not Found`

#### Scenario: Non-owner receives 404 on row append
- **WHEN** a user calls `POST /api/data-sources/:id/rows` for a source owned by another user
- **THEN** the response is `404 Not Found`, identical in shape to the response for a nonexistent id

#### Scenario: Non-owner receives 404 on row replace
- **WHEN** a user calls `PUT /api/data-sources/:id/rows` for a source owned by another user
- **THEN** the response is `404 Not Found`, identical in shape to the response for a nonexistent id
