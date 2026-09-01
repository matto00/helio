## MODIFIED Requirements

### Requirement: DELETE /api/pipeline-steps/:id removes a step

The backend SHALL expose `DELETE /api/pipeline-steps/:id` that removes the step and returns
`200 OK` with `{ "removedTailStepCount": <integer> }` on success (HEL-906 task 3.2). **BREAKING**:
this was previously `204 No Content` with no body; existing callers that assert an exact `204`
status must be updated to accept `200` instead. `removedTailStepCount` is the splice-on-delete
report: when the deleted step was a branch point (had more than one direct child), its
FIRST child (by sibling `position`) is promoted onto the deleted step's own slot, and every OTHER
child (a tail) plus that tail's full descendant subtree is removed outright —
`removedTailStepCount` is the count of those additionally-removed descendant steps. `0` for the
common case (deleting a trunk step, or a childless tail leaf); only a genuine branch point can
ever remove more than the target step itself.

Known consumers of the prior `204` response (`frontend/src/features/pipelines/services/
pipelineService.ts`'s `deletePipelineStep`, `helio-mcp/src/helioApi.ts`'s `deletePipelineStep`)
both discard the response body/status beyond "the request succeeded" — neither reads `204`
specifically nor parses a response body — so this change is **not observed to break either
consumer at runtime**; it is a contract-shape change with no functional-break follow-up filed for
that reason. (Contrast with the `pipeline-shapes/:id/expand` envelope change, whose consumers DO
parse the response body and DO break — see the `pipeline-shape-registry` delta and HEL-934.)

#### Scenario: Existing step is deleted

- **WHEN** `DELETE /api/pipeline-steps/:id` is called for an existing step with no children (or
  exactly one child)
- **THEN** the step is removed from the database and the response is
  `200 OK` with `{ "removedTailStepCount": 0 }`

#### Scenario: Deleting a branch point reports the removed-tail-step count

- **WHEN** `DELETE /api/pipeline-steps/:id` is called for a step with two direct children, where
  the second child (a tail) itself has one child of its own
- **THEN** the response is `200 OK` with `{ "removedTailStepCount": 2 }` — the first child is
  promoted onto the deleted step's slot; the second child and its own child are both removed

#### Scenario: Returns 404 for unknown step

- **WHEN** `DELETE /api/pipeline-steps/:id` is called with a step id that does not exist
- **THEN** the response is `404 Not Found`
