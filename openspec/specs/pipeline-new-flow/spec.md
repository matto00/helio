# pipeline-new-flow Specification

## Purpose
Defines the unified "New pipeline" entry: choose a source origin, create it if needed, and land
on the pipeline page with the root step already previewed.

## Requirements

### Requirement: New-pipeline entry offers five source origins
The "New pipeline" flow SHALL offer: pick an existing source, paste a table, upload a CSV (or
provide a URL), connect via a REST connector + endpoint, and text/markdown.

#### Scenario: Paste-a-table creates a static source
- **WHEN** a user pastes tabular data into the "paste a table" option and confirms
- **THEN** a static data source is created containing the pasted rows

### Requirement: Pipeline-plus-steps-plus-outputs creation is a single call
Creating the pipeline itself — including any steps and Outputs the flow has assembled (e.g. from
a chosen shape) — SHALL use exactly one `POST /api/pipelines` call carrying `roots`, `steps`, and
`outputs`. Because the flow authors a single-source pipeline, `roots` SHALL be a one-element array
whose sole element names the chosen source by `sourceId`. The scalar `sourceDataSourceId` request
field no longer exists and SHALL NOT be sent; a body carrying it is rejected with `400`.

When the flow's chosen origin requires creating a brand-new data source (paste a table, upload
CSV/URL, REST connector, text/markdown), the source SHALL be created first via the existing
source-creation route, and its resulting id passed as `roots[0].sourceId` to that one
`POST /api/pipelines` call — two calls total for a new source, one call when an existing source is
picked. The flow SHALL NOT use the endpoint's inline-source arm; it always references a
pre-existing source id.

The flow SHALL NOT offer any affordance for adding a second root. Authoring more than one root is
out of scope for this flow.

#### Scenario: New source created, then one pipeline-creation call
- **WHEN** a user completes the flow with a newly-uploaded CSV
- **THEN** exactly one source-creation call is made, followed by exactly one `POST /api/pipelines`
  call whose body carries `roots` as a one-element array holding that source's id

#### Scenario: Existing source picked needs only the pipeline call
- **WHEN** a user completes the flow by picking an existing source
- **THEN** exactly one `POST /api/pipelines` call is made, with no source-creation call, and its
  body carries `roots` as a one-element array holding the picked source's id

#### Scenario: No scalar source field is sent
- **WHEN** the flow issues its `POST /api/pipelines` call by any origin path
- **THEN** the request body contains no `sourceDataSourceId` field

### Requirement: Lands on the page with root previewed
Upon successful pipeline creation, the flow SHALL navigate directly to the new pipeline's detail page.

#### Scenario: Post-creation navigation
- **WHEN** pipeline creation succeeds
- **THEN** the user is navigated to the new pipeline's detail page with the root step's preview
  already loaded
