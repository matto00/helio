## Purpose

Bounds how many backend requests one `get_workspace_context` call sends and how many are in flight at once, while
keeping the returned payload exactly as it was.

## ADDED Requirements

### Requirement: Request count is bounded on a large workspace
One `buildWorkspaceContext` call against a server that serves `GET /api/pipelines/context-details` SHALL send at
most 8 + 1 + P + Op + D HTTP requests (P pipelines, Op Outputs with a non-zero `panelCount`, D distinct dashboards
hosting those placements, one `/api/outputs` page). On the 55-pipeline / 110-Output / 19-placed fixture it SHALL
send at most 120.

#### Scenario: 55-pipeline fixture
- **WHEN** `get_workspace_context` runs through the real HTTP client against the 55-pipeline fixture
- **THEN** it sends at most 120 requests, and the same fixture on the pre-change code sends more than 120

### Requirement: Bounded concurrency
The call SHALL have at most a fixed, documented number of requests in flight at any moment beyond the initial fixed
fetches.

#### Scenario: Peak in flight
- **WHEN** the 55-pipeline fixture runs with a delayed fake backend
- **THEN** the observed peak of concurrent requests does not exceed the documented cap

### Requirement: Payload is byte-identical
For the same backend data, the serialized result (excluding `generatedAt`) SHALL be identical to the pre-change
code's result, in full and concise mode, whether the batched read is used or the per-pipeline fallback is taken.

#### Scenario: Before and after on the fixture
- **WHEN** the fixture's result is compared with the golden captured from the pre-change code
- **THEN** they are identical in both modes and on both paths

### Requirement: Fallback to per-pipeline reads
If `GET /api/pipelines/context-details` fails (404 on an older server, or any other error) the call SHALL fetch
`laneTree` and `lastRunAssertions` per pipeline exactly as before. A pipeline absent from the batched response SHALL
be fetched per pipeline.

#### Scenario: Older server
- **WHEN** the batched read returns 404
- **THEN** the call succeeds with the same payload as the pre-change code

### Requirement: Client and server agree on the batched read's shape
The MCP's expectation of `GET /api/pipelines/context-details` and the backend's actual response SHALL both conform
to the same committed JSON schema, and against a real backend the call SHALL send no per-pipeline `/steps` or
`/run-history` request.

#### Scenario: Live seam
- **WHEN** `get_workspace_context` runs through the real HTTP client against a backend serving the read
- **THEN** zero `/api/pipelines/:id/steps` and zero `/api/pipelines/:id/run-history` requests are sent

### Requirement: Zero-panel Outputs skip the placements read
An Output whose `/api/outputs` item has `panelCount: 0` SHALL get `placements: []` without a
`GET /api/outputs/:id/panels` request; an Output with no `panelCount` field SHALL be read as before.

#### Scenario: Unplaced Output
- **WHEN** an Output reports `panelCount: 0`
- **THEN** no `/api/outputs/:id/panels` request is sent for it and its `placements` is `[]`
