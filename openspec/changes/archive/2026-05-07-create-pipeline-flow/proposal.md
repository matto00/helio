## Why

Users can view the pipeline list but have no way to create a pipeline. The "Create pipeline"
button in the empty state is a non-functional placeholder. This change wires up the full
creation flow so users can provision pipelines from the UI.

## What Changes

- Add `POST /api/pipelines` backend endpoint accepting `{ name, sourceDataSourceId, outputDataTypeName }`,
  persisting a new pipeline row, and returning the created pipeline summary.
- Wire the "Create pipeline" button in `PipelineEmptyState` to open a creation modal.
- Add a "Create pipeline" button to the `PipelineListTable` header for the non-empty state.
- Implement `CreatePipelineModal` with three required fields: pipeline name (text), data source
  (select populated via `GET /api/data-sources`), and output type name (text).
- On submit: call `POST /api/pipelines`, navigate to `/pipelines/:id`, and dispatch `fetchPipelines`.
- All three fields are required; name must be non-empty. Show inline validation errors.

## Capabilities

### New Capabilities

- `pipeline-create-api`: Backend `POST /api/pipelines` endpoint — accepts name, sourceDataSourceId,
  outputDataTypeName; creates pipeline row; returns created pipeline summary.
- `pipeline-create-modal`: Frontend creation modal — three-field form, data source select populated
  from `GET /api/data-sources`, validation, submit flow with navigation and list refresh.

### Modified Capabilities

- `pipeline-list-view`: Add "Create pipeline" button to `PipelineListTable` header (non-empty state),
  and wire existing empty-state button to open the modal.

## Impact

- Backend: new route `POST /api/pipelines` in `ApiRoutes.scala`; new repository method;
  new Flyway migration if needed (pipeline row can already be inserted given existing schema).
- Frontend: new Redux thunk `createPipeline`; new `CreatePipelineModal` component;
  updates to `PipelineEmptyState` and `PipelineListTable`.
- No breaking changes to existing endpoints.

## Non-goals

- Pipeline editing or deletion.
- Running or scheduling pipelines.
- Validation of whether the data source or output type name already exists.
