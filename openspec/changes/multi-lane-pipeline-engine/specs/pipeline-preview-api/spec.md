## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/preview returns per-Output preview rows, outputId optional
The endpoint SHALL perform a dry run over the whole graph and return preview rows for every Output, including Outputs attached to nodes in any lane and to rejoin steps. Scoping by `outputId` SHALL continue to work for an Output in any lane.

#### Scenario: Preview covers Outputs in several lanes
- **WHEN** a preview is requested for a pipeline with Outputs attached in two sibling lanes
- **THEN** preview rows are returned for the Outputs in both lanes

#### Scenario: Preview of a rejoin Output reflects both inputs
- **WHEN** a preview is requested for an Output attached to a rejoin step
- **THEN** the preview rows reflect the rejoined result, not the parent lane alone

#### Scenario: Preview scoped to one Output
- **WHEN** `POST /api/pipelines/:id/preview?outputId=<id>` is called
- **THEN** the response's `outputs` array contains exactly one entry, for that Output's own node

#### Scenario: Preview scoped to a source-bound Output (no step)
- **WHEN** `POST /api/pipelines/:id/preview?outputId=<id>` is called for an Output whose
  `node.stepId` is `None`
- **THEN** that entry's `preview.rows` are the pipeline's raw source rows (no step applied)

#### Scenario: Unknown outputId is rejected
- **WHEN** `POST /api/pipelines/:id/preview?outputId=<id>` is called with an id that does not
  exist, or that belongs to a different pipeline than the one in the path
- **THEN** the response is `404 Not Found`

#### Scenario: All-Outputs preview returns every Output on the pipeline
- **WHEN** `POST /api/pipelines/:id/preview` is called with `outputId` absent, on a pipeline with
  two or more Outputs
- **THEN** the response's `outputs` array has one entry per Output, each carrying its own node's
  preview rows

#### Scenario: All-Outputs preview de-duplicates shared-node computation
- **WHEN** `POST /api/pipelines/:id/preview` is called with `outputId` absent, on a pipeline where
  two Outputs are bound to the SAME node
- **THEN** both entries' `preview` are identical (the shared node was computed once, not twice)

#### Scenario: All-Outputs preview on a pipeline with no Outputs
- **WHEN** `POST /api/pipelines/:id/preview` is called with `outputId` absent, on a pipeline with
  zero Outputs
- **THEN** the response is `200 OK` with `{ outputs: [] }`

#### Scenario: Preview does not mutate run state, in either arm
- **WHEN** `POST /api/pipelines/:id/preview` is called, with `outputId` present OR absent
- **THEN** `pipelines.last_run_status` and `last_run_at` are unchanged after the call, in BOTH
  cases (verified by `PipelineRunServiceSpec`'s "does not mutate last_run_status/last_run_at"
  tests — one per arm — and `OutputRoutesSpec`'s HTTP-level equivalents; each test proves the
  assertion mechanism itself can detect a mutation by running a REAL run on a separate pipeline
  in between)
