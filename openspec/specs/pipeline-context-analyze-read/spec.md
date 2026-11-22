# pipeline-context-analyze-read Specification

## Purpose
A single authenticated read that returns, for every pipeline the caller owns, the analyze steps and warnings the
per-pipeline analyze route returns, so a client can ground on every pipeline's columns without one request each.

## Requirements

### Requirement: Batched pipeline analyze read
The backend SHALL serve `GET /api/pipelines/context-analyze` to an authenticated caller (session or PAT). The
response SHALL be `{ "items": [...] }` with at most one item per pipeline id that `GET /api/pipelines` (no `tag`)
returns for the same caller, in the same order, and no other pipelines. Each item SHALL carry `pipelineId`, `steps`
and `warnings`. An unauthenticated caller SHALL get `401`, like `GET /api/pipelines`.

#### Scenario: Items match the caller's pipeline list
- **WHEN** a caller who owns two pipelines and holds an editor grant on a third calls the read
- **THEN** the response has two items whose `pipelineId`s equal, in order, the ids `GET /api/pipelines` returns,
  and the granted pipeline is absent

#### Scenario: Pipeline with no steps
- **WHEN** the caller owns a pipeline with zero steps
- **THEN** its item is present with `steps: []` and `warnings: []`

### Requirement: Items equal the per-pipeline analyze route
Each item's `steps` and `warnings` SHALL equal, element for element and field for field, the `steps` and `warnings`
of `GET /api/pipelines/:id/analyze` (no `concise`) for that pipeline and the same caller, at the same data. This
SHALL hold for multi-root and branched pipelines, disabled steps, steps with a `validationError`, join and lookup
steps reading a secondary source, `upsertsource` steps whose existing-source target is missing, foreign or not a
dataset, and pipelines with non-blocking analyze warnings.

#### Scenario: Rich pipeline parity
- **WHEN** the caller owns pipelines covering each case above
- **THEN** every item's `steps` and `warnings` deep-equal that pipeline's analyze response fields

#### Scenario: A pipeline whose analysis cannot be produced
- **WHEN** producing one pipeline's analysis (its projection or a source lookup) fails on the server
- **THEN** that pipeline's item is omitted, the other items are still returned, and the response is `200`

#### Scenario: A stored step that cannot be decoded
- **WHEN** a stored step row of any listed pipeline has a config that cannot be decoded
- **THEN** the read fails with a non-2xx status, exactly as `GET /api/pipelines/context-details` does on the same row,
  and a client falls back to per-pipeline analyze

### Requirement: Another user's pipelines are never returned
The read SHALL NOT include, in any field, a pipeline, step or warning of a pipeline the caller cannot list through
`GET /api/pipelines`, including pipelines the caller holds an editor or viewer grant on. This SHALL hold when the
backend runs on a role that does not bypass row-level security.

#### Scenario: Owner, editor grantee, viewer grantee on an RLS-enforced role
- **WHEN** user A owns pipelines, grants B editor and C viewer on one of them, and each calls the read over a
  non-BYPASSRLS pool
- **THEN** A's items equal A's per-pipeline analyze, and no pipeline id or step id of A's appears in B's or C's
  response, whose items equal their own per-pipeline analyze

### Requirement: Statement count does not grow with the number of pipelines
Serving the read SHALL execute a number of database statements that does not depend on the number of pipelines,
steps or roots the caller owns.

#### Scenario: Ten versus two hundred pipelines
- **WHEN** the read is served for a caller owning 10 pipelines and then for one owning 200 of the same shape
- **THEN** both requests execute the same number of database statements

### Requirement: Additive only
Adding the read SHALL NOT change the status, body or headers of any existing route.

#### Scenario: Existing analyze route unchanged
- **WHEN** `GET /api/pipelines/:id/analyze` is called by an owner, an editor grantee or a viewer grantee
- **THEN** its status and body are what they were before this change
