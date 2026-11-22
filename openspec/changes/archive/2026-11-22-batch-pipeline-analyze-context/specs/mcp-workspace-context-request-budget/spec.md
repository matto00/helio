## MODIFIED Requirements

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

## ADDED Requirements

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
