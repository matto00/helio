# HEL-386: Pipeline op: lookup / enrich (single-key left-join against a reference DataType)

## Context

Users need to enrich rows with a few columns from a small reference table (e.g. map a code to a label) without the full join semantics `JoinStep` exposes. This is a constrained, ergonomic single-key left-join that brings in only named columns. `JoinStep` is the async / repo-touching template — study `backend/src/main/scala/com/helio/domain/steps/JoinStep.scala`.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/LookupStep.scala` — `LookupConfig(referenceDataSourceId: String, sourceKey: String, lookupKey: String, columns: Vector[String])` + tolerant `decode` + `LookupStep.evaluate` (async: resolve the reference source via `ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource`; index by `lookupKey`; left-join left rows on `sourceKey`, bringing in only `columns`; unmatched → nulls for those columns). No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.Lookup`.
* `PipelineStepProtocol.scala` — `LookupStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferLookup`: the reference schema isn't statically loadable, so output = input schema + the requested `columns` (typed `string` as a documented best-effort, since types aren't known at analyze time). No false validationError.
* `PipelineAnalyzeProtocol.scala` — `LookupAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'lookup'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time — RE-CONFIRM via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration AND again right before the delivery push.

Frontend:

* `types/pipelineStep.ts` — `LookupConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `lookupConfigOf` helper.
* New `ui/LookupConfig.tsx` editor (reference-source picker, sourceKey/lookupKey selects, columns multi-select); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `lookup` to `add_pipeline_step` + config shape.

## Acceptance criteria

- [ ] `lookup` enriches left rows with the named `columns` from the reference source on `sourceKey`=`lookupKey`; unmatched rows get nulls for those columns; existing left columns preserved. Reference resolved via the privileged internal lookup (pipeline ACL is the gate, mirroring `JoinStep`).
- [ ] Missing/invalid `referenceDataSourceId` fails at execute time with a descriptive error.
- [ ] `analyze_pipeline` appends the requested `columns` (best-effort typing documented); no false validationError.
- [ ] `pipeline_steps` op CHECK accepts `'lookup'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `lookup` + config shape.
- [ ] Tests: round-trip execution (match + unmatched) in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* Multi-key lookups (single key only here).
* DAG/branching — chains linearly.

## Dependencies

* None. Shares the async repo-touching pattern with `JoinStep` and the union op. Consider coordinating right-source ownership constraints with HEL-278 (join source restriction, already shipped — see the joinCheckF pattern in PipelineService.scala).

## CRITICAL — pre-loaded security/ACL requirement (do not re-discover; this took HEL-384's design gate 3 rounds)

Lookup references a SECOND DataSource/DataType by id (the reference table). It MUST get a symmetric `findByIdOwned` pre-flight ACL check in BOTH `PipelineService.addStep` and `PipelineService.updateStep` (`backend/src/main/scala/com/helio/services/PipelineService.scala`), mirroring the existing `joinCheckF` (`JoinConfig.rightDataSourceId`) and `unionCheckF` (`UnionConfig.otherDataSourceId`) arms — chained via the same `case xConfig => findByIdOwned(...)` / `case _ => Future.successful(Right(()))` match. HEL-278 established this pattern for join; HEL-384 added it for union. Without it, lookup ships a cross-tenant data read (a user could enrich against another tenant's reference table by id).

The design MUST include:
1. A design decision + task adding `lookupCheckF` to both `addStep` and `updateStep`.
2. BOTH a POST cross-user-404 test AND a PATCH cross-user-404 (config-unchanged) test in `PipelineStepRoutesSpec.scala` (the join ACL tests are POST-only, so the PATCH test is written fresh — same as union's task 6.8).

Do NOT rely on the picker-exclusion (frontend OP_TYPES) as a security boundary — it isn't one; the op is reachable via API/MCP.

## Design note — analyze/infer path

Lookup ADDS the brought-in columns to the schema (NOT identity passthrough like union — it's additive, more like a constrained join). The design must pin how `inferLookup` computes the output schema: it appends the named lookup columns. Whether their types can be resolved at analyze time (via the reference DataType's schema through the repo) or are best-effort/string — pin it with a testable mechanism, consistent with how the other additive ops (pivot/stringops-append) handle it. Also pin:
- Single-key match semantics.
- No-match handling (null-fill the brought-in columns — left join).
- Multiple-matches handling (first match? error? — pin it).
- Column-name collision handling.

## Merge hazard — Flyway V-number

`'lookup'` adds a value to `pipeline_steps_op_check` (V50 pattern, drop/re-add). Flyway V-numbers are NOT hardcoded — main is now past V71 (after HEL-384/PR #286 merged). Re-confirm the next free V-number via `ls backend/src/main/resources/db/migration/ | sort` immediately before writing the migration, AND again right before the delivery push. Both re-checks MUST be explicit tasks in tasks.md — the design gate REFUTES if the second is missing.

## Epic context

This is the LAST (9th of 9) leaf ticket of the HEL-336 Pipeline Op Expansion epic (v1.6). JoinStep is the template; UnionStep.scala (just merged, HEL-384, PR #286) is the closest sibling for the second-source-resolution pattern (`ctx.dataSourceRepo.findByIdInternal` + `ctx.loadSource`). LookupStep should follow that shape but with additive-schema semantics rather than passthrough.
