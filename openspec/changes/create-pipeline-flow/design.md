## Context

The `pipelines` table already exists (V22__pipelines.sql) with columns for
`source_data_source_id` (FK to data_sources) and `output_data_type_id` (FK to data_types).
The GET endpoint and list view are complete. `PipelineEmptyState` renders a non-functional
"Create pipeline" button. The creation flow needs a POST endpoint, a Redux thunk, and a modal.

The ticket requests `outputDataTypeName` on the request body — this means the backend must
create a new DataType row when a pipeline is created, or look up an existing one. Given the
non-goal (no validation of whether name exists), the simplest approach is: create a new DataType
row unconditionally, then insert the pipeline referencing it.

## Goals / Non-Goals

**Goals:**
- Add `POST /api/pipelines` accepting `{ name, sourceDataSourceId, outputDataTypeName }`
- Return the created pipeline summary (same shape as GET list items)
- Wire "Create pipeline" button in empty state and add one to the list table header
- Implement `CreatePipelineModal` with three fields and inline validation
- Navigate to `/pipelines/:id` on success and refresh the list

**Non-Goals:**
- Checking for duplicate DataType names
- Pipeline editing or deletion
- Running or scheduling pipelines

## Decisions

**D1: Backend creates a DataType on pipeline creation.**
The FK `output_data_type_id` references `data_types`. Since the request carries a name (not an ID),
the backend must insert a DataType row with that name. This mirrors how the data-types API works
(`POST /api/data-types`). The DataTypeRepository already has an `insert` method. The pipeline
creation will be a two-step DB operation (insert DataType, then insert Pipeline) run sequentially
in Scala Futures.

**D2: No database transaction wrapping.**
Existing patterns (DataSourceRepository, DataTypeRepository) do not use explicit transactions
for single-row inserts. To stay consistent, the pipeline creation will do sequential inserts
without DBIO.seq transaction wrapping. If the pipeline insert fails after the DataType insert,
an orphaned DataType row will remain — acceptable given the non-goal of strict validation.

**D3: `createPipeline` thunk navigates on success inside the component, not inside the thunk.**
Keeping navigation in the component (via `useNavigate` + `unwrapResult`) stays consistent with
the panel creation pattern. The thunk returns the created pipeline ID; the component handles
`navigate('/pipelines/:id')`.

**D4: Data source select populated from Redux state.**
`PipelinesPage` already fetches pipelines on mount. `CreatePipelineModal` will dispatch
`fetchDataSources` (from the existing datasources slice) only if the data sources list is not
already loaded. This avoids an extra fetch in most cases.

**D5: `PipelineListTable` header button pattern.**
The table `<thead>` already has a multi-column row. The "Create pipeline" button will be added
in a new `<tr>` inside `<thead>` spanning all columns (or as a toolbar `<div>` above the table)
to keep table semantics valid. A toolbar div above the table is preferred for cleaner markup.

## Risks / Trade-offs

- Orphaned DataType row if pipeline insert fails (see D2). Acceptable for now.
- The DataType created for `outputDataTypeName` has no owner assigned — the DataType domain
  model requires `ownerId`. The pipeline context doesn't have a real owner in the current
  unauthenticated dev setup. The insert will use the same demo user ID used by existing DemoData.

## Planner Notes

Self-approved: no new external dependencies, no breaking API changes, no architectural changes.
The modal pattern follows `CreateDashboardModal`/`CreateDataTypeModal` conventions.
