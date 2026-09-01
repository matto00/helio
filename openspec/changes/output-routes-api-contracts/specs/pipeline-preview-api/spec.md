## Purpose

Let a caller dry-run a pipeline and see one Output's (or every Output's) preview rows before
committing to a real run, without persisting any node snapshot changes.

## ADDED Requirements

### Requirement: POST /api/pipelines/:id/preview returns per-Output preview rows, outputId optional
The backend SHALL expose `POST /api/pipelines/:id/preview?outputId=<id>` — `outputId` is an
OPTIONAL query parameter, matching P1.4's `preview_outputs(pipelineId, outputId?)` MCP tool
contract. Both arms return the SAME envelope shape, `{ outputs: [{ outputId, preview }] }`, where
`preview` is the pre-existing single-node preview shape (`rows`, `rowCount`, `stepRowCounts`,
`sourceRowCount`, `sourceTruncated`, `sourceAvailableRowCount`, `truncationNotice`,
`truncatedReads`) — so a caller has exactly one response shape to parse regardless of which arm
ran:

- **`outputId` present**: the envelope's `outputs` array has exactly one entry, for that Output's
  own node (`output.node.stepId`, `None` meaning the pipeline's raw source). `outputId` is
  resolved via the SAME sharing-aware `outputRepo.findById` select `GET /api/outputs/:id` uses,
  and is rejected (404) if it belongs to a DIFFERENT pipeline than the one in the path.
- **`outputId` absent**: the envelope's `outputs` array has one entry per Output on the pipeline
  (ACL gated at the pipeline level, via `pipelineRepo.findByIdShared`, since there is no single
  Output to resolve ACL through). Outputs sharing the same node are computed ONCE, not once per
  Output. If ANY node's preview computation fails, the whole call fails (the first failure
  encountered) rather than returning a partial envelope. A pipeline with zero Outputs returns
  `{ outputs: [] }`, not an error.

The dry run SHALL NOT write any `node_snapshots` rows, and SHALL NOT mutate
`pipelines.last_run_status`/`last_run_at`, in EITHER arm.

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
