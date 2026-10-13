## Why

HEL-1491 added an analyze-time step error for a `union` that puts a `timestamp` field and an `integer`/`float` field under the same name. It only fires when analyze can see the secondary input's schema, and analyze resolves a `source`-kind secondary's schema only for `join` (projection) and `join`/`lookup` (schema warnings). A `union` with a data-source secondary — the default union shape (`SecondaryInput.Default = Source("")`) — always analyzes with `secondarySchema = None`, so the collision check never fires there and the projection silently omits every secondary-only column the run will actually produce.

## What Changes

- **Assumed product call (OWNER REVIEW):** analyze resolves a `source`-kind secondary's inferred schema for `union`, as it already does for `join`. Recommendation taken under the overnight rules; the PR is parked for owner review.
- `PipelineAnalyzeService.sourceDependencyOf` (projection) and `secondarySourceIdOf` (prefetch set + schema warnings) include `union`. Every analyze path already prefetches through `resolveSecondarySourceSchemas`, so no call site changes.
- Consequences (verified by tests): a source union's projected schema gains the source's secondary-only fields; the timestamp/numeric collision check fires; `AnalyzeSchemaWarnings` treats a source union as name-complete when the source schema resolved (types stay untrusted, as for every union), so `field-not-in-input-schema` warnings can now fire downstream of it.
- Output `fieldMapping` validation (transactional create `400`, proposal-analyze per-Output `validationError`) checks against the projected schema, so an Output at or below a source union may now map a column only the source carries; today that is rejected. This is a widening.
- Agent-facing text that calls union's analyzed schema a passthrough is corrected (`helio-mcp/src/tools/write.ts`, plus a sweep of `backend/src`, `helio-mcp/src`, `docs/`, `openspec/specs/`).
- A source that is missing, unconfigured (`""`) or has no inferred schema keeps the documented passthrough.
- `TimestampNumberParitySpec`'s pinned KNOWN GAP guard flips to assert the error; the `pipeline-union-op` spec and `docs/compute-expression-grammar.md` known-limitation text are updated.
- No run-time change, no migration, no API shape change.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-union-op`: the analyze-inference requirement and the timestamp/numeric collision requirement now cover a `source`-kind secondary whose schema resolves (passthrough / no check only when it cannot be resolved).
- `pipeline-analyze-api`: the per-node projection scenario for a `source`-kind union secondary now projects the source-only fields when the source schema resolves.
- `pipeline-analyze-schema-warnings`: a `union` whose `source`-kind secondary schema resolves is name-complete for downstream `field-not-in-input-schema` warnings.

## Impact

- Backend: `backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala`; comments in `PipelineServiceSupport.scala` / `MultiInputSchemaInference.scala` if they state join-only.
- Tests: `TimestampNumberParitySpec`, `PipelineAnalyzeServiceSpec`, `AnalyzeSchemaWarningsSpec`, plus a service/route-level test proving the prefetch reaches a real data source's schema.
- Docs/specs: `docs/compute-expression-grammar.md`, `openspec/specs/pipeline-union-op`, `openspec/specs/pipeline-analyze-api`, `openspec/specs/pipeline-analyze-schema-warnings`.
- helio-mcp: `helio-mcp/src/tools/write.ts` union tool description.
- Overlap: open PR #986 (HEL-1455) edits `AnalyzeSchemaWarnings.scala` and `docs/compute-expression-grammar.md`; this change does not edit `AnalyzeSchemaWarnings.scala` and edits a different doc section. #986 also edits `openspec/specs/pipeline-analyze-schema-warnings/spec.md` (a different requirement from the one this change modifies); whoever merges second re-checks the archived MODIFIED block against the rebased base.
