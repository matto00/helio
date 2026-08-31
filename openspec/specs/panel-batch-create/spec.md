# panel-batch-create Specification

## Purpose
Lets a caller create many new panels on one existing dashboard in a single atomic call, so an agentic
board build (e.g. `helio-news`'s per-story image/markdown/data-panel fan-out) collapses to one request
instead of one `POST /api/panels` per panel.

## Requirements

### Requirement: POST /api/panels/batch endpoint exists

The backend SHALL expose a `POST /api/panels/batch` endpoint that accepts `{ dashboardId, panels:
[...] }`, where each entry in `panels` carries the same `title`/`type`/`config`/`appearance` fields
as `POST /api/panels`'s `CreatePanelRequest` (minus `dashboardId`, supplied once at the envelope
level). On success the backend creates every panel on `dashboardId` in a single transaction and
returns them, with freshly minted ids, in the same order as the request's `panels` array.

#### Scenario: Multiple panels are created in one call
- **WHEN** the owner of a dashboard sends `POST /api/panels/batch` with `dashboardId` and three
  panel specs (e.g. one image, one markdown, one metric)
- **THEN** the response is 201 with all three created panels, each carrying a fresh id, in the same
  order the request supplied them

#### Scenario: Created panels persist identically to single create
- **WHEN** a batch item's `config`/`appearance` (including a chart's `appearance.chart.chartType`)
  is applied via `POST /api/panels/batch`
- **THEN** the persisted panel is identical to what `POST /api/panels` would have produced for the
  same `title`/`type`/`config`/`appearance` values

### Requirement: Batch create is all-or-nothing

The backend SHALL create zero panels and return HTTP 400 identifying the offending item by its
1-based index and title (an absent/omitted `title` renders as an empty string, never omitted from
the message) if any item in the `panels` array is invalid (unrecognized `type`, invalid
`appearance.chart.chartType`, or a `config.dataTypeId` binding that violates the pipeline-only
rule).

#### Scenario: One bad item rejects the whole batch
- **WHEN** a `POST /api/panels/batch` payload's second item has an invalid `type`
- **THEN** the response is 400 naming panel 2, and no panel from the batch (including the valid
  first and third items) is created

#### Scenario: V41 binding violation rejects the whole batch
- **WHEN** a `POST /api/panels/batch` payload's item binds `config.dataTypeId` to a source-companion
  (non-pipeline-output) DataType
- **THEN** the response is 400 (pipeline-only binding rule) and no panels in the batch are created

#### Scenario: Empty panels array is rejected
- **WHEN** a `POST /api/panels/batch` payload's `panels` array is empty
- **THEN** the response is 400 and no panels are created

### Requirement: Batch create does not build a pipeline chain

A batch item's `config.outputId` (when present) SHALL only bind to an existing, accessible Output
— identical to `POST /api/panels`'s placement rule. Batch create SHALL NOT accept inline
source/pipeline/step/output definitions; building a new pipeline or Output remains out of scope
for this endpoint.

#### Scenario: Batch item places an existing Output
- **WHEN** a batch item's `config.outputId` names an existing, accessible Output
- **THEN** the created panel is placed against that Output, exactly as a single `POST /api/panels`
  call with the same `config` would produce

#### Scenario: Batch item binds to an existing pipeline-output DataType
- **WHEN** a batch item's `config.outputId` names an existing, accessible Output (a pipeline
  output — the DataType concept it previously referenced no longer exists)
- **THEN** the created panel is placed against that Output, exactly as a single `POST /api/panels`
  call with the same `config` would produce

### Requirement: Batch create is owner-scoped

`POST /api/panels/batch` SHALL only permit the dashboard's owner or an editor-grantee to
batch-create panels on it, mirroring `POST /api/panels`'s ACL. A caller with no access to
`dashboardId` SHALL receive 404 (no existence leak); a caller with only viewer access SHALL receive
403; nothing is created in either case.

#### Scenario: Cross-tenant caller cannot batch-create
- **WHEN** a caller who is neither the owner nor a grantee of `dashboardId` sends `POST /api/panels/
  batch`
- **THEN** the response is 404, and no panels are created on that dashboard

#### Scenario: Viewer-only grantee cannot batch-create
- **WHEN** a caller with only viewer access to `dashboardId` sends `POST /api/panels/batch`
- **THEN** the response is 403, and no panels are created

#### Scenario: Owner batch-creates on their own dashboard
- **WHEN** the dashboard's owner sends a valid `POST /api/panels/batch` payload
- **THEN** the panels are created and returned, all owned by the caller

### Requirement: Batch create only affects the panels it is given

`POST /api/panels/batch` SHALL only ever INSERT the panels supplied in the request — it SHALL NOT
delete, modify, or otherwise touch any panel that already exists on `dashboardId`.

#### Scenario: Existing panels are untouched
- **GIVEN** a dashboard with two existing panels
- **WHEN** the owner sends `POST /api/panels/batch` with one new panel spec
- **THEN** the response contains only the one newly created panel, and the dashboard's two
  pre-existing panels are unchanged in every field
