# HEL-975: Rename RootSourceSchemaResponse.sourceDataSourceName to dataSourceName for per-root shape consistency

## Description

HEL-913 moved a pipeline's source from a scalar to a `roots[]` array and introduced two per-root response shapes that name the same concept differently:

* `PipelineRootSummaryResponse(id, dataSourceId, dataSourceName)` — `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:87`
* `RootSourceSchemaResponse(rootId, sourceDataSourceName, sourceSchema)` — `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala:184`

`RootSourceSchemaResponse` kept the `source`-prefixed name inherited from the retired singular `sourceDataSourceName` scalar it replaced, while its sibling dropped the prefix.

### Why this matters

Surfaced during HEL-969, which repaired the frontend for the multi-root contract. HEL-969's AC3 required a zero-hit grep for `sourceDataSourceName` under `frontend/src`, but the analyze API still *sends* a field by exactly that name — so the frontend type could satisfy the AC or name the wire field truthfully, not both. HEL-969 resolved it by omitting the field from `RootSourceSchema` entirely, which is safe but leaves the frontend unable to model that field under a truthful name if a consumer ever appears.

### Scope (as filed, corrected by premise validation)

* Rename `RootSourceSchemaResponse.sourceDataSourceName` to `dataSourceName`, matching `PipelineRootSummaryResponse`.
* Update the analyze route's JSON protocol, its tests, and `openspec/specs/pipeline-analyze-api/`.
* No frontend change is required — the field is currently unconsumed there (verified: zero hits under `frontend/src`).

**Premise-validation correction (see `.concertino/runs/HEL-975/evidence/premise-validation.md`):** the filed Scope list is under-inclusive. This is a wire-format rename, and the following consumers are in scope and MUST be updated in the same change:

* `schemas/pipelines/pipeline-analyze-response.schema.json` (`required` array + property name)
* `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` (`required` array + property name)
* `helio-mcp/src/types.ts` — `RootSourceSchemaResponse.sourceDataSourceName`, and its consumers `helio-mcp/src/context.test.ts` and `helio-mcp/src/tools/pipelineProposalHandlers.test.ts`

Because `helio-mcp` is an external/agent-facing client that types this field, the rename is a **breaking wire change** and must be stated plainly in the PR description.

Explicitly OUT of scope: `PipelineRepository.PipelineSummary.sourceDataSourceName` and the `pipeline-list-api` / `pipeline-edit-flow` / `patch-set-apply` specs, which name the unrelated pipeline-list summary scalar rather than a per-root response shape.

## Acceptance criteria

- [ ] AC1: `RootSourceSchemaResponse` exposes `dataSourceName`, not `sourceDataSourceName`.
- [ ] AC2: No per-root response shape in the pipelines protocols uses the `source`-prefixed spelling.
- [ ] AC3: `openspec/specs/pipeline-analyze-api/` reflects the renamed field. **Scope clarification:** only the
  per-root requirement "Source schema derived from bound DataSource's registered DataType fields"
  (`spec.md:116`) is in scope. The stale mention at `spec.md:50` names the *retired singular scalar*
  removed by HEL-913, not this per-root field; leaving it untouched is correct and is not an AC3 failure.
- [ ] AC4: Backend tests green.
- [ ] AC5: Both `schemas/pipelines/pipeline-analyze-response.schema.json` and `schemas/pipelines/pipeline-analyze-proposal-response.schema.json` name `dataSourceName` in both their `properties` and `required` arrays, and `npm run check:schemas` passes.
- [ ] AC6: `helio-mcp` types and tests use `dataSourceName`; `helio-mcp` typecheck and tests green.
- [ ] AC7: At least one backend test asserts, against the **parsed JSON object** of a serialized response
  body (not `entityAs[PipelineAnalyzeResponse]`, and **not** substring containment — `dataSourceName` is a
  substring of `sourceDataSourceName`, so `body should include("dataSourceName")` passes against the
  pre-rename wire and proves nothing), that for a root's `sourceSchemas` entry:
  (a) its JSON field-key set **contains** `dataSourceName`;
  (b) its JSON field-key set **does not contain** `sourceDataSourceName`;
  (c) the `dataSourceName` value is a non-empty `JsString`.
  All three halves are required at the AC level. This guards both the spray-json absent-field trap this
  repo has repeatedly hit and the substring trap above.
- [ ] AC8: `grep -rn "sourceDataSourceName" backend/src/main/scala/com/helio/api/protocols schemas/pipelines
  helio-mcp/src frontend/src` returns **no hits other than the eight comment/description lines enumerated
  below**, each of which narrates the *retired singular scalar* (accurate history, deliberately preserved
  per design D5) rather than declaring a live field:
  - `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineAnalyzeProtocol.scala:181`
  - `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala:103`
  - `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala:125`
  - `schemas/pipelines/pipeline-analyze-response.schema.json:17` (a `description` string)
  - `helio-mcp/src/types.ts:277`
  - `helio-mcp/src/types.ts:503`
  - `helio-mcp/src/context.ts:321`
  - `helio-mcp/src/runPipelineTruncation.test.ts:23`
  Every residual hit MUST be classified: it is permitted only if it is a comment/description narrating the
  retired scalar. A residual hit that is a live field declaration, wire key, or `required`-array entry
  fails AC8. Line numbers may shift; classify by content, not by line number. Deleting these comments to
  force a literal zero is **not** an acceptable way to satisfy AC8.

## Constraints

- No database migration. The dev Postgres is shared with concurrent runs HEL-981 and HEL-980 — do not write a migration; escalate instead if one appears necessary.
- No production database or deploy access.
