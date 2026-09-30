## Purpose
Lets a viewer trace an Output back to its source(s), pipeline node path, last run and check counts in one call, for authenticated users and for public/shared dashboards.

## ADDED Requirements

### Requirement: Authenticated provenance read
`GET /api/outputs/:id/provenance` SHALL return, for an Output the caller can read, its `sources` (name and kind of every root feeding the Output, ordered by root position), `pipeline` (`id`, `name`), `nodePath` (step kinds from the root to the Output's node), `lastRun` (`status`, `completedAt`, `rowCount` of the Output's own node snapshot; null when the pipeline never ran a non-dry run), and `assertions` (`defined`, `passed`, `failed`, `warned`, `rootBound`). An Output the caller cannot read SHALL yield `404`.

#### Scenario: One-root Output
- **WHEN** an Output on a step of a single-root pipeline is requested
- **THEN** exactly one source is returned with the node path of that step and the last run's status, completedAt and snapshot row count

#### Scenario: Two roots via join
- **WHEN** an Output on a join node fed by two roots is requested
- **THEN** both sources are returned, each with name and kind

#### Scenario: Join with a direct Source secondary input
- **WHEN** an Output on a join/union/lookup node whose secondary input names a data source directly is requested
- **THEN** that data source is included among the sources; a data source that no longer resolves is omitted

#### Scenario: Root-bound Output
- **WHEN** an Output bound directly to a root is requested
- **THEN** that root's source is returned, `nodePath` is empty, and assertions report `defined:false, rootBound:true` with zero counts

#### Scenario: No assertions defined
- **WHEN** the Output's node has no assert steps
- **THEN** `assertions.defined` is false and all counts are zero

#### Scenario: Never run
- **WHEN** the pipeline has no non-dry run
- **THEN** `lastRun` is null

#### Scenario: Bounded queries
- **WHEN** provenance is computed for any Output
- **THEN** the number of database reads does not grow with the number of roots, steps or assertions

### Requirement: Public provenance read is an explicit allowlist
`GET /api/dashboards/:dashboardId/panels/:panelId/provenance` SHALL be authorized by the same `authorizeResourceWithSharing` dashboard gate, share-token handling and panel-to-Output resolution as `output-meta`, and SHALL return only: source names and kinds, pipeline name, node path step kinds, `lastRun.status`, `lastRun.completedAt`, `lastRun.rowCount`, and assertion counts. It SHALL NOT contain any id, source config or credential, `errorLog`, assertion `observed` value, `ownerId`, or pipeline link.

#### Scenario: Excluded fields are absent
- **WHEN** an anonymous caller with a valid share token requests provenance for a panel
- **THEN** the response JSON has exactly the allowlisted keys and none of the excluded ones

#### Scenario: Another dashboard's panel
- **WHEN** a panel id belonging to a different dashboard is requested under this dashboard
- **THEN** the response is 404

#### Scenario: Missing or invalid token
- **WHEN** the dashboard is not public and the token is missing or invalid
- **THEN** the request is denied identically to `output-meta`

#### Scenario: Panel without an Output
- **WHEN** the panel has no bound Output or is not an Output panel
- **THEN** the response is 404
