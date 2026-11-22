# mcp-workspace-context-request-budget Specification

## Purpose
Bounds how many backend requests one `get_workspace_context` call sends and how many are in flight at once, while
keeping the returned payload exactly as it was.

## Requirements

### Requirement: Request count is bounded on a large workspace
One `buildWorkspaceContext` call against a server that serves both `GET /api/pipelines/context-details` and
`GET /api/pipelines/context-analyze` SHALL send at most 8 + 2 + Op + D + A HTTP requests (Op Outputs with a non-zero
`panelCount`, D distinct dashboards hosting those placements, A pipelines absent from the analyze batch, one
`/api/outputs` page). The count SHALL NOT depend on the number of pipelines P: with Op, D and A held fixed it SHALL be
the same at 55 and at 200 pipelines. On a 200-pipeline fixture it SHALL send fewer than 120.

#### Scenario: 55-pipeline fixture
- **WHEN** `get_workspace_context` runs through the real HTTP client against the 55-pipeline fixture
- **THEN** it sends exactly 8 + 2 + Op + D + A requests (31 on that fixture: 19 placed Outputs, 1 dashboard, 1 absent
  pipeline), and with the analyze batch answering 404 it sends exactly one more than the HEL-1619 count (85)

#### Scenario: Constant in P
- **WHEN** `get_workspace_context` runs through the real HTTP client against fixtures of 55 and 200 pipelines with
  the same placed Outputs, dashboards and absent pipelines
- **THEN** both send the same number of requests, and no `/api/pipelines/:id/analyze` request is sent for a
  pipeline present in the batch

#### Scenario: 200-pipeline fixture
- **WHEN** `get_workspace_context` runs against the 200-pipeline fixture
- **THEN** it sends fewer than 120 requests, and the same fixture on the pre-change code sends more than 120

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

### Requirement: Fallback to per-pipeline analyze
If `GET /api/pipelines/context-analyze` fails (404 on an older server, any other error, or a body without an `items`
array) the call SHALL fetch each pipeline's analyze exactly as before. A pipeline absent from the batched response
SHALL be analyzed per pipeline. A failure other than 404, a malformed body, or absent pipelines SHALL write one
stderr line naming the read. The payload SHALL be identical on every path.

#### Scenario: Older server
- **WHEN** the analyze batch returns 404
- **THEN** the call succeeds with the golden payload, writes no stderr line, and sends one analyze per pipeline

#### Scenario: One pipeline absent
- **WHEN** the analyze batch omits one pipeline
- **THEN** exactly that pipeline is analyzed per pipeline and the payload equals the golden

### Requirement: Client and server agree on the analyze batch's shape
The MCP's fake `GET /api/pipelines/context-analyze` body and the backend's actual response SHALL both conform to the
same committed JSON schema, and against a real backend the call SHALL send no `/api/pipelines/:id/analyze` request
for a pipeline the batch returned.

#### Scenario: Live seam
- **WHEN** `get_workspace_context` runs through the real HTTP client against a backend serving the read
- **THEN** zero `/api/pipelines/:id/analyze` requests are sent and the payload equals the per-pipeline path's
