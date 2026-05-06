## 1. Backend

- [x] 1.1 Create Flyway migration for `pipelines` table (id, name, source_data_source_id FK, output_data_type_id FK, last_run_status nullable, last_run_at nullable, created_at, updated_at)
- [x] 1.2 Add `Pipeline` domain case class and `PipelineSummary` response case class in backend models
- [x] 1.3 Add `PipelineId` value-class ID wrapper
- [x] 1.4 Add Slick table mapping for `pipelines` in the repository layer
- [x] 1.5 Implement `PipelineRepository.listSummaries` with a joined query (pipelines + data_sources + data_types) returning `PipelineSummary`
- [x] 1.6 Add `PipelineSummary` JSON formatter in `JsonProtocols.scala`
- [x] 1.7 Register `GET /api/pipelines` route in `ApiRoutes.scala` returning the list from `PipelineRepository`

## 2. Frontend

- [x] 2.1 Define `PipelineSummary` TypeScript interface in `frontend/src/types/`
- [x] 2.2 Add `getPipelines` function in the API service layer (`frontend/src/services/`)
- [x] 2.3 Create `pipelinesSlice.ts` with `fetchPipelines` async thunk and `idle/loading/succeeded/failed` status
- [x] 2.4 Register `pipelinesSlice` reducer in the Redux store
- [x] 2.5 Create `PipelineEmptyState` component (message + "Create pipeline" placeholder button)
- [x] 2.6 Create `PipelineListTable` component rendering rows with name, source, output type, last-run status badge, and last-run timestamp
- [x] 2.7 Create `PipelinesPage` component that dispatches `fetchPipelines` on mount, renders loading/error/list/empty states
- [x] 2.8 Register `/pipelines` route in the React Router config
- [x] 2.9 Add "Data Pipelines" `NavLink` to the app sidebar navigation

## 3. Tests

- [x] 3.1 Write Jest tests for `pipelinesSlice` covering `fetchPipelines` pending/fulfilled/rejected transitions
- [x] 3.2 Write Jest tests for `PipelinesPage` covering empty state render and list render with mock pipeline data
