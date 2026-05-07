## Context

The backend already has a `pipelines` table (V22 migration) and a `PipelineRepository` with a
`PipelineTable` Slick mapping. The infrastructure follows a consistent pattern:
`*Repository.scala` contains both the repository class and a companion `object` with
`*Row`/`*Table` Slick definitions. Route handlers live in `backend/.../api/routes/` as dedicated
`*Routes.scala` files composed in `ApiRoutes.scala`.

`PipelineRoutes` currently handles only `GET /api/pipelines`. The four pipeline-step endpoints
will be added to the same file or a new `PipelineStepRoutes` file, depending on scoping.

## Goals / Non-Goals

**Goals:**
- V23 migration: `pipeline_steps` table with FK → `pipelines`, position, op CHECK, config (TEXT)
- `PipelineStepRepository` with list-by-pipeline, insert, update, delete operations
- Route handlers for all four endpoints wired into `ApiRoutes`
- ScalaTest coverage for the repository and routes

**Non-Goals:**
- Frontend editor wiring (HEL-180)
- Step execution or pipeline run orchestration
- Step ordering enforcement beyond returning rows sorted by `position`

## Decisions

**D1: Separate PipelineStepRoutes file**
Step endpoints straddle two URL prefixes (`/pipelines/:id/steps` and `/pipeline-steps/:id`).
A dedicated `PipelineStepRoutes.scala` keeps `PipelineRoutes` focused on the pipeline resource
and avoids mixing path prefixes. Matches how `DataSourceRoutes` and `SourceRoutes` are split.

**D2: PipelineStepRepository follows PipelineRepository conventions**
Row case class + Slick Table class live in the companion object. `instantColumnType` is already
defined in `PipelineRepository`; the step repo will import it or duplicate it locally to avoid
a cross-object dependency.

**D3: config stored as TEXT (JSON blob)**
The ticket specifies `config TEXT` with op-specific JSON. The backend will treat it as an opaque
string — no parsing. The frontend is responsible for serializing/deserializing the JSON. This
avoids adding a Postgres JSON column type dependency and keeps the migration simple.

**D4: position auto-assigned on POST**
POST `/api/pipelines/:id/steps` computes `position = MAX(position) + 1` (or 0 if no steps exist)
inside a single DB transaction. No client-supplied position on create; client can reorder via PATCH.

**D5: Use TEXT primary keys (UUIDs generated server-side)**
Consistent with all other entities (`pipelines`, `data_sources`, `data_types`, `panels`).

## Risks / Trade-offs

- **Position gaps on delete**: Deleting a step leaves gaps in position sequence. The PATCH endpoint
  allows reordering so gaps are tolerable; no re-numbering on delete. → Acceptable for v1.
- **Config validation deferred to frontend**: Invalid JSON stored in config column is not caught
  server-side. → Mitigation: frontend validates before POST/PATCH.

## Migration Plan

1. Add `V23__pipeline_steps.sql` — creates table + index; safe to roll back by dropping the table
   (no existing data depends on it).
2. Add repository, routes, domain types — no changes to existing tables or routes.
3. Wire `PipelineStepRoutes` in `ApiRoutes`.

## Planner Notes

Self-approved: no external dependencies, no breaking changes, follows established patterns.
