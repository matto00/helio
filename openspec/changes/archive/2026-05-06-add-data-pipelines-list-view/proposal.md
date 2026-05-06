## Why

Helio v1.3 introduces Data Pipelines as a first-class resource. Users need a central place to view, manage, and create pipelines — right now there is no UI entry point. This list view is the foundation of the pipelines section.

## What Changes

- Add a "Data Pipelines" nav item in the sidebar/navigation, linking to `/pipelines`
- Add a `/pipelines` route that renders the pipeline list view
- Implement `GET /api/pipelines` backend endpoint returning pipeline summaries
- Show pipeline name, source data source, output DataType name, last-run status, and last-run timestamp
- Empty state with a "Create pipeline" placeholder button when no pipelines exist
- Wire frontend to the new API endpoint (Redux slice + thunk)

## Capabilities

### New Capabilities

- `data-pipelines-nav`: Navigation link and route to the Data Pipelines section
- `pipeline-list-view`: Frontend list view showing all pipelines with name, source, output DataType, last-run status, and last-run timestamp; includes empty state with create button
- `pipeline-list-api`: Backend `GET /api/pipelines` endpoint returning pipeline summaries (name, source data source name, output data type name, last run status, last run timestamp)

### Modified Capabilities

- `frontend-data-sources-page`: Navigation structure changes to accommodate the new Pipelines section alongside Data Sources and Data Types

## Impact

- New backend route and handler in `ApiRoutes.scala`
- New Slick query to fetch pipeline summaries joined with data sources and data types
- New Redux slice `pipelinesSlice` with async thunk for list fetch
- New React components: `PipelinesPage`, `PipelineListTable`, `PipelineEmptyState`
- Sidebar navigation component updated to add the Pipelines link

## Non-goals

- Pipeline creation form / wizard (placeholder button only)
- Pipeline execution / run triggering
- Pipeline detail/edit view
- Filtering or sorting of the pipeline list
- Pagination (assumes manageable number of pipelines initially)
