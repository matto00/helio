## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 42b3cc5c13c2d64255ccbd32d4bd2f359affcd8e; base 677db0a8 (resolve-review-base.sh).

### What I verified (with evidence)
- Read full diff of backend (repo/service/route/protocol), schema, helio-mcp (write.ts, assertSchemas.ts, pipelinesHandlers.ts, helioApi.ts, runWarnings.ts).
- AC1: guard `rejectIfReparents` aborts via DBIO.failed(ReparentRejected) after reading existingChildren and before the insert, inside transactionally -> 422 naming ids, nothing written. Applied on every splice path (parentStepId, rootId, no-anchor trunk-last, position-index). MCP add_pipeline_step sends the flag by default; attachAsTail=true requires parentStepId (tool-level error), since backend ignores it elsewhere. add_outputs_from_shape pre-reads children and attaches sibling or guards. Only MCP callers of the steps POST are these two handlers (grep). Repro (two same-root aggregates): second add via rootId now 422s loudly; no silent splice.
- Frontend/patch-set callers: flag absent = unchanged; addStep retained delegating; duplicateStep unchanged; response gets only additive reparentedStepIds on POST create.
- AC2: run_pipeline now returns runId, stepRowCounts, stepCountsAvailable, warnings; spark/empty counts reported as unavailable, not clean. Honest limit (counts can't reveal wrong values) documented.
- AC3: schema, docs/agent-native.md, helio-mcp README, tool descriptions, openspec deltas all updated and consistent with behaviour.
- Fresh gates: `npx jest helio-mcp` 34 suites/341 tests pass; helio-mcp typecheck clean; `sbt testOnly *PipelineStepReparentRoutesSpec *PipelineStepRoutesSpec` 97 pass. Evaluator's pasted testFull (5200, 0 failed) and mutation results accepted as pasted/unambiguous; I did not re-run the full suite. sbt client shut down. No live DB probes, no rows created.

### Verdict: CONFIRM

### Non-blocking notes
- ReparentRejected message says "omit rejectIfReparents (attachAsTail=false)", which is backend-API wording; for MCP callers the equivalent is attachAsTail=false. Also shape-tool 422 wording mentions attachAsTail which that tool doesn't expose (evaluator noted too). Follow-up polish.
- Patch-set/apply paths still splice by design (out of this ticket's MCP-tool scope).
