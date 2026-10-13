## Standing Constraints

- [C1] Do not edit any file in open PR #986's (HEL-1455) file list, except the "Known limitation: a timestamp-typed column that carries a number" section of docs/compute-expression-grammar.md; every new behavioural assertion must be shown red on the base commit or under a named mutation.

## 1. Analyze resolution

- [x] 1.1 Add `union` (decoded via `UnionConfig.decode`, `Source(id)` with `id.nonEmpty`) to `PipelineAnalyzeService.sourceDependencyOf` and `secondarySourceIdOf`; update their doc comments and the `analyzeNodes` HEL-1236 comment.
- [x] 1.2 Grep every `analyzeNodes(` call site and confirm each passes a map built by `resolveSecondarySourceSchemas`; update any comment that says join/lookup-only (`PipelineServiceSupport.resolveSecondarySourceSchemas`, `MultiInputSchemaInference` union doc if it says source is unresolved).
- [x] 1.3 Grep `frontend/src` and `helio-mcp/src` for any local union schema projection; record the result (expected: none).
- [x] 1.4 Sweep `backend/src`, `helio-mcp/src`, `docs/` and `openspec/specs/` for every statement that union analyze is a passthrough or that a union's source secondary is unresolved, and correct each one that this change makes false (known hits: `helio-mcp/src/tools/write.ts` ~L463; `MultiInputSchemaInference.scala` ~L55-62; `PipelineAnalyzeService.scala` ~L201-203, ~L252-254, ~L305-307; `PipelineServiceSupport.scala` ~L91-99; test comment `PipelineCreateInlineSourceCleanupSpec.scala` ~L110). Canonical `openspec/specs/` hits are handled by this change's deltas at archive time; do not edit `openspec/specs/` directly. Do NOT edit any file in PR #986's file list. Record every hit and its disposition.

## 2. Tests (each shown red on base or under a mutation)

- [x] 2.1 `TimestampNumberParitySpec`: replace the KNOWN GAP guard with (a) a source union with a supplied `ts: integer` schema reports the collision error and keeps `ts` as `timestamp`, (b) a source union whose source is absent from the map passes through with no error.
- [x] 2.2 `PipelineAnalyzeServiceSpec`: source union appends secondary-only fields; empty `dataSourceId` passes through; reverse collision (numeric parent, timestamp source) also errors.
- [x] 2.3 `AnalyzeSchemaWarningsSpec`: a resolved source union is name-complete (warn on a column in neither input, not on a source-only column); an unresolved one still suppresses.
- [x] 2.4 Seam test: a service- or route-level analyze over a persisted pipeline whose union secondary is a real data source row with an inferred schema returns the appended fields and the collision `validationError` (step-config-invalid reason). Use throwaway `@example.test` users only.
- [x] 2.5 Write-path widening test (red on base): a `POST /api/pipelines` (transactional create) or analyze-proposal whose Output, at or below a source-kind union, maps a column only the source's inferred schema carries — rejected on base, accepted after the change.
- [x] 2.6 Second seam assertion through the node capabilities path (`capabilities?stepId=`, `PipelineNodeReads`) for a step below a source union, showing the source-only field.
- [x] 2.7 Run the touched specs plus `com.helio.domain.engine` and the pipelines service/route specs as package shards in the foreground (nice -n 19, capped workers); record exactly what ran.

## 3. Docs and specs

- [x] 3.1 `docs/compute-expression-grammar.md`: update only the "Known limitation: a timestamp-typed column that carries a number" section — source unions are now checked when the source has an inferred schema; state the remaining passthrough cases.
- [x] 3.2 Confirm the spec deltas in this change match the implemented behaviour.

## Task results

**1.2 `analyzeNodes(` call sites** (all pre-resolve through `resolveSecondarySourceSchemas`, whose id set is `secondarySourceIdOf`, now including `union`):
- `PipelineAnalyzeReads.scala:80` / `:115` and `:215` / `:232` (persisted analyze, concise analyze)
- `PipelineNodeReads.scala:210` / `:224` (capabilities / validate-expression node projection)
- `PipelineProposalAnalyze.scala:62` / `:84` (caller-scoped `findByIdOwned`)
- `PipelineCreateTransaction.scala:74` / `:75` (transactional create, `findByIdInternal`)
- The two-argument `analyzeNodes(steps, sourceSchema)` overload (`PipelineAnalyzeService.scala`) passes no map by design and is used only by tests.

**1.3 client-side union projection:** none in `frontend/src` or `helio-mcp/src`. The only "union"/"passthrough" hit, `frontend/src/features/pipelines/state/stepNarrowing.ts:751`, is about config-type widening, not schema; unchanged.

**1.4 sweep (`backend/src`, `helio-mcp/src`, `docs/`, `openspec/specs/`) and dispositions:**
- `helio-mcp/src/tools/write.ts` ~L463 union description: corrected.
- `MultiInputSchemaInference.scala` union doc (~L55-62) and the HEL-1491 collision note: corrected.
- `MultiInputSchemaInference.scala` lookup doc (~L14-16, "identity-passthrough group `join`/`union`", "same limitation `union` already documents"): corrected in cycle 2 (lookup keeps placeholder types because `sourceDependencyOf` excludes it).
- `PipelineAnalyzeService.scala` `secondarySourceIdOf`, `sourceDependencyOf`, `analyzeNodes` HEL-1236 comment: corrected.
- `PipelineServiceSupport.scala` `resolveSecondarySourceSchemas` doc: corrected.
- `PipelineCreateInlineSourceCleanupSpec.scala` ~L110 comment: corrected.
- `PipelineAnalyzeServiceSpec.scala` ~L146-150 (HEL-384 union comment): reworded in cycle 2 (passthrough holds because no secondary schema is supplied).
- `PipelineAnalyzeServiceSpec.scala` ~L1258 (lane test) and ~L1331 test title ("source-kind secondaryInput ... still degrades"): still true (no map supplied); unchanged.
- `docs/compute-expression-grammar.md` known-limitation section: updated. No other docs hit.
- `openspec/specs/pipeline-union-op` requirement title "documented best-effort passthrough" and the union analyze/collision requirements: handled by this change's deltas at archive; not edited directly (title kept, see design.md).
- `openspec/specs/pipeline-analyze-api` and `pipeline-analyze-schema-warnings`: handled by deltas.
