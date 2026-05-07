# HEL-228: Pipeline steps — DB schema and CRUD API

## Description

Add backend persistence for pipeline transformation steps.

## DB Migration (V23)

```sql
CREATE TABLE pipeline_steps (
  id          TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  position    INT  NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('rename', 'filter', 'join', 'compute', 'groupby', 'cast')),
  config      TEXT NOT NULL,  -- JSON blob: op-specific field config
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX pipeline_steps_pipeline_id_idx ON pipeline_steps(pipeline_id);
```

## API Endpoints

- `GET /api/pipelines/:id/steps` — return ordered steps for a pipeline
- `POST /api/pipelines/:id/steps` — append a new step
- `PATCH /api/pipeline-steps/:id` — update step config or position
- `DELETE /api/pipeline-steps/:id` — remove a step

## Frontend Integration

Wire the pipeline editor (HEL-180) to load/save/reorder/delete steps via these endpoints once shipped.

## Acceptance Criteria

- DB migration V23 creates pipeline_steps table with all specified columns and constraints
- GET /api/pipelines/:id/steps returns steps ordered by position
- POST /api/pipelines/:id/steps appends a new step (auto-assigns next position)
- PATCH /api/pipeline-steps/:id updates step config and/or position
- DELETE /api/pipeline-steps/:id removes a step
- All endpoints return appropriate HTTP status codes and JSON responses
- Backend tests cover all four endpoints
