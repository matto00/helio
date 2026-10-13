## Context

`PipelineAnalyzeService.analyzeNodes` resolves a step's secondary schema from either the lane walk (`laneDependencyOf`, covers join/union/lookup) or a caller-supplied `secondarySourceSchemas` map via `sourceDependencyOf` (join only). The map is built by `PipelineServiceSupport.resolveSecondarySourceSchemas`, whose id set comes from `secondarySourceIdOf` (join + lookup). `AnalyzeSchemaWarnings.secondaryOf` also uses `secondarySourceIdOf` for the `source` branch. `MultiInputSchemaInference.inferUnion` already does the right thing when given `Some(secondary)`: it appends secondary-only fields and runs the HEL-1491 timestamp/numeric collision check. So a source-kind union fails only because nothing ever hands it the schema.

Run time (`UnionStep.evaluate`): `byPosition` is `rows ++ otherRows`, `byName` pads to the union of both key sets. Either way secondary-only columns are present in the output rows, so the current passthrough projection under-reports what a run produces. A lane-kind union already projects them.

## ASSUMED PRODUCT CALL (overnight rules — OWNER REVIEW)

The ticket asks: should analyze resolve a source secondary's schema for `union` too? The owner was asleep; under the overnight rules this run takes the recommendation and parks the PR unmerged for owner review.

**Assumed answer: yes**, for projection, the collision check and schema warnings alike, on every analyze path.

Why: (1) it makes analyze agree with what the run produces (secondary-only columns do appear in rows); (2) it closes the HEL-1491 gap on the default union shape; (3) it makes a source union behave exactly like a lane union and like a source join, which already do this; (4) it is read-only: run time, stored data and the API shape are unchanged, and a missing/unconfigured/schema-less source keeps the passthrough. Cost the owner should weigh: existing source unions will show extra columns in downstream pickers, a source union with a timestamp/numeric name collision will now show a step error (and `canRun: false`, which only hides the editor's "Run to update" prompt), downstream `field-not-in-input-schema` warnings can now appear where they were suppressed, and `POST /api/pipelines` / analyze-proposal will now ACCEPT an Output whose `fieldMapping` names a column only the source carries at or below a source union (today a `400` / per-Output `validationError`, because `validateOutputFieldMapping` checks against the projected schema). Agent-facing text (`helio-mcp/src/tools/write.ts`) that tells agents the union's analyzed schema is a passthrough is corrected. The spec requirement title "Union op analyze-inference is a documented best-effort passthrough" is kept (renaming it is cosmetic churn in a parked PR); the owner may rename it. Alternative rejected: resolve only for the collision check without changing the projection (an analyze that checks a schema it does not project is inconsistent with join/lane-union and still under-reports columns).

## Goals / Non-Goals

**Goals:**
- Source-kind union analyze sees the source's inferred schema wherever join's does.
- Verify (not assume) the projection and `AnalyzeSchemaWarnings` consequences with tests that are red on the base commit.

**Non-Goals:**
- Any run-time change, migration (none needed; V131 stays free), API/schema-JSON change, frontend change.
- Changing `lookup`'s source-secondary projection (still placeholder types, intentionally join/union-only in `sourceDependencyOf`).
- Editing files touched by open PR #986 (HEL-1455) — notably `AnalyzeSchemaWarnings.scala`, `ComputeTypeWarnings.scala`, `ExpressionTypeInference.scala`, `ExpressionParser.scala`, `ExpressionEvaluator.scala`, `ExpressionNumericContexts.scala`, `PipelineAnalyzeProtocol.scala`. `openspec/specs/pipeline-analyze-schema-warnings/spec.md` is also in #986, but this change's delta modifies a different requirement ("Missing referenced field warns"); the merger-second re-checks that MODIFIED block after a rebase. The one shared source-adjacent file, `docs/compute-expression-grammar.md`, is edited only in the "Known limitation: a timestamp-typed column that carries a number" section (#986's hunks are at ~L262 and ~L315-336).
- Fixing the `fillnull` mean/median half of the known limitation (already flagged; unchanged).

## Decisions

1. **Add `union` to `sourceDependencyOf` and to `secondarySourceIdOf`** in `PipelineAnalyzeService.scala`, decoding `UnionConfig` with the same tolerant `Try` and `nonEmpty` filter. Update both doc comments. `lookup` stays out of `sourceDependencyOf`. Every analyze call site (`PipelineAnalyzeReads` x2, `PipelineNodeReads`, `PipelineProposalAnalyze`, `PipelineCreateTransaction`) already pre-resolves through `resolveSecondarySourceSchemas`; the executor re-verifies this by grep and records the result. Alternative (a new union-only helper) rejected: two near-identical id functions invite drift.
2. **Accept the `AnalyzeSchemaWarnings` change without editing that file.** Through `secondarySourceIdOf` a resolved source union becomes `names = true` (types stay untrusted: `typesPreserved` returns false for `union`). This matches a lane union. Pinned by a new `AnalyzeSchemaWarningsSpec` test.
3. **Access policy unchanged:** persisted paths resolve with `findByIdInternal` (pipeline ACL is the gate, same as `UnionStep.evaluate` and join), the proposal path with caller-scoped `findByIdOwned`. Union's write-time ownership pre-flight already exists (`validateStepCrossOwnerRefs`).
4. **Frontend:** no change expected; the executor greps `frontend/src` for any client-side union schema mirror and records the result.
5. **Tests (red first):** flip the KNOWN GAP guard in `TimestampNumberParitySpec` to assert the error for a source union when `secondarySourceSchemas` carries the source, and keep a guard that a source with no supplied schema still passes through; add `PipelineAnalyzeServiceSpec` projection cases (appended fields; empty `dataSourceId`; absent from map); add an `AnalyzeSchemaWarningsSpec` case; add one service/route-level test against a real data source row with an inferred schema proving the prefetch reaches it (the seam). Each new assertion must be shown failing on the base commit or under a mutation that removes `union` from the relevant function.

## Risks / Trade-offs

- [Visible change on existing pipelines] Source unions gain columns, may gain a step error or downstream warnings → owner review (PR parked); read-only, reversible by reverting two match arms.
- [Write-path widening] Output fieldMapping validation now accepts source-only columns below a source union → stated for the owner; pinned by a test red on base.
- [Inferred schema staleness] A source's `inferredSchema` may lag its data → same exposure join already has; documented passthrough when empty.
- [Merge overlap with #986] Doc section adjacency → different sections; whichever merges second rebases.
