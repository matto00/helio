## ADDED Requirements

### Requirement: Create-step request can refuse implicit re-parenting
`POST /api/pipelines/:id/steps` SHALL accept an optional boolean `rejectIfReparents`. When `true` and the resolved insert (explicit `parentStepId`, `rootId`, or the no-anchor trunk-last default) would re-parent one or more existing steps, the request SHALL fail with 422, nothing SHALL be persisted, and the message SHALL list the step ids that would be moved. When absent or `false`, behaviour SHALL be unchanged. The flag is evaluated on the placement path the backend actually takes: `attachAsTail` is honoured ONLY together with `parentStepId` (a sibling tail, which never re-parents and is never rejected); with `rootId` or no anchor `attachAsTail` is ignored by the backend, so the flag still applies there.

#### Scenario: Guarded splice over an anchor with a child
- **WHEN** a step is created with `parentStepId=X`, X has child C, `rejectIfReparents=true`
- **THEN** the response is 422 naming C, and the step count and C's parent are unchanged

#### Scenario: Guarded no-anchor add whose trunk-last has tails
- **WHEN** a step is created with neither anchor on a single-root pipeline whose trunk-last step has a tail, `rejectIfReparents=true`
- **THEN** the response is 422 naming the tail

#### Scenario: attachAsTail without parentStepId is not a free pass
- **WHEN** a step is created with `attachAsTail=true`, no `parentStepId`, `rejectIfReparents=true`, and the trunk-last step has a tail
- **THEN** the response is 422 naming the tail (the backend splices on that path, so it is guarded)

#### Scenario: Flag absent
- **WHEN** the same request omits `rejectIfReparents`
- **THEN** the splice proceeds exactly as before

### Requirement: Create-step response reports re-parented steps
The create response of `POST /api/pipelines/:id/steps` (and only that response; not GET, PATCH or duplicate) SHALL include `reparentedStepIds`, the array of existing step ids whose parent changed, empty when none.

#### Scenario: Splice reparents an existing child
- **WHEN** a step is created after anchor X (no attachAsTail, no guard) and X had child C
- **THEN** `reparentedStepIds` contains C's id

#### Scenario: Tail attach moves nothing
- **WHEN** a step is created with `attachAsTail=true`
- **THEN** `reparentedStepIds` is `[]`
