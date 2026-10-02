## Context

Probe (local backend, raw HTTP to the endpoints helio-mcp calls) established: the default `persistNewStep` path for a `parentStepId`/`rootId` anchor calls `spliceInsertAtInternal`, which makes the new step the anchor's only child and re-parents ALL existing children under it. `attachAsTail=true` calls `attachTailInternal` (sibling, nothing moved). The MCP tool never forwards `attachAsTail`, so a sibling lane off one root is only reachable via multi-root (`add_root`). Invalid anchors already 422/400 loudly; the silent case is a VALID anchor with existing children. The ticket's "wrong branch" wording is the splice working as designed. A zero count appears when the demoted step references a field the new parent no longer outputs. `stepRowCounts` is already in `RunResultResponse` but dropped by `helioApi.runPipeline`'s `RunOutcome`.

## Goals / Non-Goals

**Goals:** nothing is moved unless the caller asked; every move is reported; a zero-row node is visible in the run result.
**Non-Goals:** changing backend splice default (the frontend editor and patch-sets rely on it; changing it breaks insert-in-the-middle); `analyze_pipeline` field/type warnings; join column-collision semantics (follow-ups).

## Decisions

1. **Guard in the backend behind an opt-in flag; MCP always opts in.** A server-side `rejectIfReparents` flag (absent = current behaviour) makes the repo, which already computes `existingChildren` inside `spliceInsertAtInternal`, the single source of truth for "what would move" for EVERY placement shape (explicit `parentStepId`, `rootId` = parentless steps with that root_id, and the no-anchor trunk-last default whose tails would move). It avoids duplicating `trunkOf`/root logic in TypeScript and is not subject to a client-side TOCTOU. When the flag is true and children would move, the splice DBIO aborts BEFORE any write and the service returns 422 listing the ids. The frontend editor and patch-sets never send it, so their splice semantics are untouched. Rejected alternative: making absent-attachAsTail a backend error: breaks insert-in-the-middle in the editor and patch-set apply/undo.
2. **Tri-state `attachAsTail` in the MCP tool.** undefined => send `rejectIfReparents:true`; true => `attachAsTail:true`; false => explicit splice (flag not sent). `attachAsTail:true` without `parentStepId` (rootId or no anchor) is a tool-level error: the backend honours attachAsTail ONLY in the `(Some(parentStepId), None)` branch, so on the other paths it would be ignored and silently splice. The backend flag is likewise evaluated on the placement path actually taken. Consequence documented: `rootId` on a root that already has root-level steps trips the guard, so "append to the end of a trunk" uses `parentStepId = <last step>` (childless, unguarded).
3. **`add_outputs_from_shape`.** Its docs say "branching off stepId", i.e. sibling. The handler reads the pipeline's steps once; if `stepId` has children it sends the first expanded step with `attachAsTail:true`; otherwise it sends it plainly. Absent `stepId` sends `rejectIfReparents:true` (multi-root already 400s). Subsequent expanded steps chain off the previous step (childless) unchanged.
4. **Response mechanism: create-only.** `PipelineStepResponse` is a sealed trait with many case classes; `reparentedStepIds` is NOT added to each. The create route merges `reparentedStepIds` into the serialized JSON object of the create response only (GET/PATCH/duplicate unchanged). A new service method (`addStepReporting`, returning the response plus moved ids) carries the ids to the route; `addStep` keeps its signature for the three patch-set callers by delegating and discarding. `spliceInsertAtInternal` returns the moved ids alongside the step through its five call sites; `duplicateStep` discards them (clone-after-original is its documented semantic). A protocol round-trip test pins the shape on create and its absence elsewhere.
5. **Run warnings computed in MCP from existing data** (spec rule in `mcp-run-pipeline-step-counts`). No backend run-contract change. Counts come from `stepRowCounts` (step keys only; disabled steps have no entry), lane refs from `config.secondaryInput` (`kind:"lane"`, `stepId`) for join/union/lookup, narrowed defensively. Spark-executed runs return empty counts: reported as `stepCountsAvailable:false`, never as a healthy empty `warnings`. "Primary root" is whichever root the backend's `sourceRowCount` reflects (first root by position); if GET /pipelines/:id root order cannot be verified to match, root-level steps are skipped. A filter that legitimately yields 0 rows also warns; the tool description says warnings are prompts to check, not errors. Honest limit: counts cannot reveal wrong VALUES (probe scenario D keeps count 3 while `n=0`), so the placement guard is the primary fix and the counts are the secondary signal.
6. **Schema/doc sites (no response schema exists):** `schemas/pipelines/create-pipeline-step-request.schema.json` (add `rejectIfReparents`, refresh `attachAsTail` description); `docs/agent-native.md`; `helio-mcp/README.md`; tool descriptions in `write.ts`/`pipelines.ts`; helio-mcp `types.ts` and frontend `PipelineStepResponse` type only if they model the create response. Existing specs `pipeline-run-execution` and `patch-set-lane-edits` need no change.

## Risks / Trade-offs

- The shape handler's children pre-read is client-side (TOCTOU possible); the response `reparentedStepIds` surfaces any resulting move.
- Behaviour change for MCP callers that relied on implicit splice: they now get a clear error naming the explicit flag. Intended.
- Extra GET per add_pipeline_step: negligible.

## Migration Plan

No migration. Additive JSON field. MCP tool schema gains optional param.

## Gate-Chain Implications Checklist

N/A — no `.husky/**` or commit-gate scripts touched.
