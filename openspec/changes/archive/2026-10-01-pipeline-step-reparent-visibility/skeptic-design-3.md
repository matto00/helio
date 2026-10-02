## Skeptic Report - design gate (round 3, skeptic-design-3.md)

### What I verified (against code, HEAD 677db0a8)
- Round-2 CR1 resolved: design Decision 2 + placement spec reject attachAsTail:true without parentStepId in the tool; backend spec restated so the flag is evaluated on the path actually taken (matches persistNewStep: attachAsTail honoured only in the (Some(parent), None) branch, PipelineService ~L1960-1972). Test coverage added in tasks 1.1/2.1. addStepReporting wrapper noted in design Decision 4 and task 1.2.
- Silent-move enumeration: all splice placements (rootId, parentStepId, no-anchor trunk-last, position) go through spliceInsertAtInternal, which reads existingChildren before `stepsTable += newRow`, so abort-before-write is feasible in one DBIO; classifyDbError already has a typed-DBIO-failure arm pattern (PipelineCycleRejected). `position` is not exposed by the MCP add_pipeline_step tool. MCP callers of api.addPipelineStep: only addPipelineStepHandler and addOutputsFromShapeHandler, both covered. Invalid anchors already 422/400 (existing behaviour, retained).
- Artifacts consistent: proposal / design / tasks / three specs agree on flag name, tri-state, create-only reparentedStepIds, run_pipeline fields, stepCountsAvailable. All ACs covered: AC1 (guard + tool), AC2 (stepRowCounts/warnings), AC3 (schema, docs, README, descriptions in tasks 1.2/2.2/3.2). No TODO/TBD placeholders.
- Probe report cross-checked against code (mechanism A/B/D/E, stepRowCounts dropped by RunOutcome).

### Verdict: CONFIRM

### Non-blocking notes
- MCP patch-set refinement (refinement.ts L94) can still splice by omitting attachAsTail, but that is documented, previewed and undoable, and is not a step-adding tool call; leave out of scope but consider mentioning in the delivery PR.
- add_outputs_from_shape with a childless stepId sends no guard (client pre-read TOCTOU); response reparentedStepIds surfaces any race. Sending the guard in that case too would be free; optional.
- Warning rule's primary-root determination must be verified at implementation (skip root-level steps if ordering unverifiable), as designed.
- Follow-up tickets (task 4.0) must actually be filed at delivery.
