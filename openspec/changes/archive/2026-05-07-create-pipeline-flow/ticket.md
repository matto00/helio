# HEL-230: Create pipeline flow

## Title
Create pipeline flow

## Description
Allow users to create a new pipeline from the Pipelines list page.

**Backend:**

* `POST /api/pipelines` — accepts `{ name, sourceDataSourceId, outputDataTypeName }`, creates a new pipeline row, returns the created pipeline summary.

**Frontend:**

* Wire the "Create pipeline" button in `PipelineEmptyState` (and add a matching button to the `PipelineListTable` header for non-empty state).
* Opens a modal with three fields:
  * Pipeline name (text input)
  * Data source (select from existing data sources via `GET /api/data-sources`)
  * Output type name (text input — the name for the new DataType that will be created when the pipeline runs)
* On submit: `POST /api/pipelines`, then navigate to `/pipelines/:id` for the new pipeline.
* On success: dispatch `fetchPipelines` to refresh the list.

**Validation:** all three fields required; name must be non-empty.

## Acceptance Criteria
- Users can click "Create pipeline" from the empty state or the list table header
- A modal opens with three required fields: pipeline name, data source (select), and output type name
- All three fields are required; name must be non-empty
- On submit, `POST /api/pipelines` is called with `{ name, sourceDataSourceId, outputDataTypeName }`
- On success, user is navigated to `/pipelines/:id` for the new pipeline
- On success, the pipelines list is refreshed via `fetchPipelines`
- Backend endpoint creates the pipeline row and returns the created pipeline summary
