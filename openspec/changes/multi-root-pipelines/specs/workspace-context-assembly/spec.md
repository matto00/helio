## MODIFIED Requirements

### Requirement: Workspace context endpoint
Each pipeline entry in the workspace context SHALL carry a `roots` array, each element identifying a root by id, its data source id, and that source's name, in root-position order. The scalar `sourceDataSourceId` / `sourceDataSourceName` pair SHALL be removed, not retained alongside `roots`.

#### Scenario: A two-root pipeline lists both roots
- **WHEN** workspace context is assembled for a pipeline with two roots
- **THEN** its entry carries two root elements in position order, each with a root id, source id, and source name

#### Scenario: A single-root pipeline lists one root
- **WHEN** workspace context is assembled for a pipeline with one root
- **THEN** its entry carries a one-element `roots` array and no scalar source field

#### Scenario: Authenticated caller fetches workspace context
- **WHEN** an authenticated user with at least one data source, Output, pipeline, and dashboard
  calls `GET /api/workspace/context`
- **THEN** the response is `200` with a body containing `generatedAt`, `counts`, `dataSources`,
  `dataTypes`, `pipelines`, `dashboards`, `joinHints`, and `truncation`, matching
  `schemas/workspace/workspace-context.schema.json`

#### Scenario: Empty workspace returns empty collections, not an error
- **WHEN** an authenticated user with no data sources, Outputs, pipelines, or dashboards calls
  `GET /api/workspace/context`
- **THEN** the response is `200` with `counts` all zero, every collection field an empty array, and
  `truncation.applied: false`

#### Scenario: Negative budgetBytes is rejected
- **WHEN** an authenticated user calls `GET /api/workspace/context?budgetBytes=-1`
- **THEN** the response is `400 Bad Request`

#### Scenario: budgetBytes of zero requests the smallest possible response
- **GIVEN** an authenticated user with at least one Output carrying sample rows and column
  statistics
- **WHEN** that user calls `GET /api/workspace/context?budgetBytes=0`
- **THEN** the response is `200`, every `dataTypes[].sampleRows` is `[]`, every
  `dataTypes[].columnStats[*].exampleValues` is `[]`, `joinHints` is `[]`, and
  `truncation.structuralFloorExceedsBudget` is `true`

