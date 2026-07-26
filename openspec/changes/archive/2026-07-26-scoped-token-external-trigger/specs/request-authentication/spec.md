## ADDED Requirements

### Requirement: PATs may carry an optional pipeline-scoped allow-list
`POST /api/tokens` SHALL accept an optional `scopedPipelineIds` field (a non-empty array of pipeline
ids the caller owns or has editor access to — viewer-only access is insufficient, since a viewer
grantee can never trigger a run and a token scoped to such a pipeline could never succeed). When
absent (the default), the created token behaves exactly as an unscoped PAT does today — full account
access on every authenticated route. When present, the token SHALL be persisted with that allow-list
and is subject to the confinement rule in the `external-run-hooks` capability, enforced once, ahead
of every route branch, so no route family (including optional-auth/public read routes) can resolve a
scoped token to unscoped identity. `GET /api/tokens` SHALL surface `scopedPipelineIds` (when set)
alongside the existing metadata fields; it SHALL NOT be required to authenticate.

#### Scenario: Minting an unscoped token is unaffected
- **WHEN** `POST /api/tokens` is called with `{ "name": "..." }` and no `scopedPipelineIds`
- **THEN** the system returns `201 Created` with a token that authenticates every authenticated
  route exactly as before this change

#### Scenario: Minting a scoped token
- **WHEN** `POST /api/tokens` is called with `{ "name": "helio-news", "scopedPipelineIds":
  ["<owned-pipeline-id>"] }`
- **THEN** the system returns `201 Created` with a raw `helio_pat_...` token, and
  `GET /api/tokens` subsequently lists that token's `scopedPipelineIds`

#### Scenario: Scoping to a pipeline the caller cannot access
- **WHEN** `POST /api/tokens` is called with `scopedPipelineIds` containing a pipeline id the caller
  neither owns nor has been granted access to
- **THEN** the system returns `400 Bad Request` and does not create the token

#### Scenario: Scoping to a pipeline the caller can only view
- **WHEN** `POST /api/tokens` is called with `scopedPipelineIds` containing a pipeline id the caller
  has only viewer (not editor/owner) access to
- **THEN** the system returns `400 Bad Request` and does not create the token

#### Scenario: Scoping to an empty array is rejected
- **WHEN** `POST /api/tokens` is called with `scopedPipelineIds: []`
- **THEN** the system returns `400 Bad Request`
