# HEL-384: Pipeline op: union / append (stack rows from a compatible source)

URL: https://linear.app/helioapp/issue/HEL-384/pipeline-op-union-append-stack-rows-from-a-compatible-source

## Context

There is no way to stack rows from a second source onto the current pipeline (e.g. combine two CSV exports). `JoinStep` is the only async / repo-touching op today and is the template for resolving a second `DataSource` via `ctx.dataSourceRepo` + `ctx.loadSource`. Study `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala` closely.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/UnionStep.scala` — `UnionConfig(otherDataSourceId: String, mode: String)` + tolerant `decode` + `UnionStep.evaluate` (async, resolves the other source via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource`, like `JoinStep`) + `companion`. Modes: `byPosition` (append rows assuming identical columns) and `byName` (align on column names, missing → null). No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.Union`.
* `PipelineStepProtocol.scala` — `UnionStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferUnion`. The other source's schema is not statically known at analyze time (parity with the fact that `JoinStep` has no analyze case); output schema = input schema unchanged (documented best-effort passthrough — do NOT emit a false validationError).
* `PipelineAnalyzeProtocol.scala` — `UnionAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'union'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend). **Re-confirm the current max migration number via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration, AND again before the delivery push.**

Frontend:

* `types/pipelineStep.ts` — `UnionConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `unionConfigOf` helper. NOTE: `join` is intentionally excluded from `OP_TYPES` (picker) pending HEL-278 (restrict pipeline JoinStep right-source to caller-owned-or-shared data); decide whether to expose `union` in the picker now or keep it out like join — document the choice.
* New `ui/UnionConfig.tsx` editor (other-source picker, mode toggle); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `union` to `add_pipeline_step` + config shape. `add_pipeline_step`'s `type` param is free-text `z.string()` — document the new op in the tool description string.

## Acceptance criteria

- [ ] `union` stacks rows from the other source; byPosition and byName modes both work; the other source is resolved via the privileged internal lookup (pipeline ACL is the gate, mirroring `JoinStep`).
- [ ] Missing/invalid `otherDataSourceId` fails at execute time with a descriptive error.
- [ ] `analyze_pipeline` passes the input schema through unchanged (documented best-effort, no false validationError).
- [ ] `pipeline_steps` op CHECK accepts `'union'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `union` + config shape.
- [ ] Tests: round-trip execution (both modes) in `InProcessPipelineEngineSpec.scala`; analyze passthrough test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* Source-type restrictions beyond what the engine already supports (static/csv today) — match `PipelineRunService`'s existing source-type gate.
* DAG/branching — chains linearly.

## Dependencies

* None. Shares the async repo-touching pattern with `JoinStep` and the lookup/enrich op.

## Orchestrator notes (from task assignment, not part of the original ticket)

- This op is DIFFERENT from the seven transform ops shipped so far (datebucket/pivot/window/unpivot/dedupe/fillnull/stringops were all single-input per-row/per-column transforms). Union is ASYNC and REPO-TOUCHING. `JoinStep` is the template — study its `evaluate` signature (async/Future, uses `StepContext`), its second-DataSource resolution, and its infer path (JoinStep has NO analyze/infer case — union's analyze path is best-effort passthrough, not identical to JoinStep, but should model its absence-of-static-schema situation).
- Follow the op-wiring checklist end to end: new step, apply + infer(analyze) parity, `allowedOps` surface, Flyway migration, frontend StepCard config editor (UnionConfig.tsx + co-located .test.tsx per CONTRIBUTING), `pipelineStep.ts` additions (mirror `JoinConfig` since it's the async sibling), exhaustive-match consumers (`domain/package.scala`, `PipelineStepRepository.rowToDomain`, `PipelineService.toAnalyzeStepResponse`, `stepNarrowing.ts`), MCP tool description update.
- DESIGN GATE FOCUS: the design must pin the COLUMN RECONCILIATION policy for `byPosition` vs `byName` modes — what happens when the two sources have different columns (union of columns with nulls for missing? intersection only? require identical schema?), column-name/type-mismatch handling, and how the analyze/infer OUTPUT SCHEMA is computed (ticket says best-effort passthrough of input schema, not computed from both sources — pin this explicitly and justify parity with JoinStep's lack of an analyze case).
- MERGE HAZARD: 'union' adds a value to the `pipeline_steps_op_check` constraint (V50 pattern). Flyway V-numbers are NOT hardcoded — re-confirm the current max via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration AND again before the delivery push. Both re-checks must be explicit tasks in tasks.md.

## Correction (post skeptic design-gate round 1, ground-truth verified)

The original scope text above (and this orchestrator's own initial framing in design.md/proposal.md) cited HEL-278 as an open/tracked gap analogous to `union`'s cross-user source exposure. **That was stale.** HEL-278 ("Restrict pipeline JoinStep right-source to caller-owned or shared data sources") is **DONE** (completed 2026-05-24, PRs #171/#173): `PipelineService.addStep`/`updateStep` already run a `findByIdOwned` pre-flight ACL check for `JoinConfig.rightDataSourceId`, returning 404 for a cross-user right-source at creation/update time (runtime `evaluate` still uses the privileged `findByIdInternal` by design — steps valid at authoring time keep working). Because `UnionConfig` has no arm in that same match today, `union` would ship with a REAL, unmitigated cross-tenant ACL gap — worse than `join`'s current state, not equivalent to it. **This change now explicitly includes**: a symmetric `findByIdOwned` pre-flight check for `UnionConfig.otherDataSourceId` in both `addStep` and `updateStep`, plus a mirrored 404/201 test pair (see `PipelineStepRoutesSpec.scala`'s existing join tests for the pattern). Separately, `join`'s exclusion from the `OP_TYPES` picker turns out to be primarily because no `JoinConfig.tsx` frontend editor has ever been built (HEL-264's original rationale), not primarily the ACL gap — so `union`, which DOES ship a full editor in this change and now has the ACL check, should be exposed in the picker rather than mirroring `join`'s exclusion. See design.md Decisions 7 and 9 for the full revised rationale.
