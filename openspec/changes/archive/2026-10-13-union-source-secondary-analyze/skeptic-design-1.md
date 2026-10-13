## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD `37311542aed346150f7eceda407be1560265f546` (planning artifacts untracked in the change dir).

Scope note: the ASSUMED PRODUCT CALL (resolve a `source`-kind secondary's schema for `union`) is not itself being refuted. It is clearly labelled, it is parked for owner review, and its rationale holds against the tree. The refutation is about specs left contradictory, one agent-facing doc left stale, and one consequence for the write path that the artifacts do not state.

### What I verified (with evidence)

- **Core mechanism (Decision 1) holds.**
  - `PipelineAnalyzeService.scala:204-209`: `secondarySourceIdOf` covers join and lookup only.
  - `:255-259`: `sourceDependencyOf` covers join only.
  - `:308-309`: the lane dependency is tried first, then the source map.
  - `MultiInputSchemaInference.inferUnion` (`:64-73`) already appends secondary-only fields and runs `timestampNumberCollision` when it gets `Some(secondary)`.
  - So adding a `union` arm to both functions is enough, and the stated cause is correct.
- **Every analyze path goes through the shared resolver.** There are 5 `analyzeNodes` call sites:
  - `PipelineAnalyzeReads.scala:80/115` and `:215/232`
  - `PipelineNodeReads.scala:210/224`
  - `PipelineProposalAnalyze.scala:62/84`
  - `PipelineCreateTransaction.scala:74-75`

  Each builds its map with `resolveSecondarySourceSchemas` (`PipelineServiceSupport.scala:100-107`). That function takes its ids from `secondarySourceIdOf` and drops a source whose schema is empty or missing (`.filter(_.nonEmpty)`), so AC3's fallback to passthrough comes free.
  - The linear `PipelineAnalyzeService.analyze` (`:143`, which passes secondary `None`) has no production caller; the only hits are tests.
  - Nothing in `frontend/src` or `helio-mcp/src` calls these functions.
  - Patch-set preview does not use schema inference.
- **Runtime is unchanged and runs are not gated.**
  - `RunConfigGate.scala:20` and `AutoRunTriggerService.scala:131` gate only on `stepConfigProblem`, which checks config only. The inference-time collision error therefore cannot block a run, which matches the design's "canRun:false only hides the prompt" claim.
  - `UnionStep.evaluate` (`byPosition` = `rows ++ otherRows`; `byName` pads both key sets) does put secondary-only columns in the rows. The claim that the projection under-reports holds.
- **No false positives from CSV sources.** I checked whether CSV secondaries would trigger the collision error spuriously, because CSV rows load as strings (`InProcessPipelineEngine.scala:799-811`). They do not: `SchemaInferenceEngine.fromCsvLines` (`:39-73`) declares every CSV column `StringType`. JSON-inferred `integer`/`timestamp` types match the values those sources deliver at run time.
- **Decision 2 (AnalyzeSchemaWarnings) holds.**
  - `secondaryOf` (`AnalyzeSchemaWarnings.scala:95-97`) builds a source secondary with `Flags(names=true, types=true)`.
  - For `union`, names are `in.names && sec.exists(_.flags.names)`.
  - `typesPreserved` has no `union` arm, so it falls to `case _ => false`.
  - Result: a resolved source union is name-complete but its types stay untrusted, as claimed.
  - PR #986's per-column trust rewrite (`gh pr diff 986`) also leaves `union` on `case _ => false`, so the claim holds whichever PR merges first.
- **PR #986 overlap.**
  - #986's files, confirmed with `gh pr view 986 --json files`, do not include `PipelineAnalyzeService.scala`, `PipelineServiceSupport.scala`, `MultiInputSchemaInference.scala` or `helio-mcp/src/tools/write.ts`.
  - Its doc hunks are at `@@ -262` and `@@ -315`. The section this change edits is `docs/compute-expression-grammar.md:347-375`, so the hunks do not overlap.
  - #986 also edits `openspec/specs/pipeline-analyze-schema-warnings/spec.md`, a file the design's non-goals list does not mention. It touches the requirements "Analyze responses carry schema-only warnings", "Join key type mismatch warns" and "Numeric use of a text field warns". It does not touch "Missing referenced field warns", which is the one this change's delta modifies, so there is no textual conflict (see the non-blocking notes).
- **Existing tests stay valid as "absent from map" guards**:
  - `PipelineAnalyzeServiceSpec.scala:1328`
  - `AnalyzeSchemaWarningsSpec.scala:171`
  - `TimestampNumberParitySpec.scala:179`, which the plan deliberately flips.

  `PipelineAnalyzeServiceSpec.scala:151` uses the linear `analyze`, so it is unaffected.

### Verdict: REFUTE

### Change Requests

1. **The spec delta leaves the live union collision requirement contradicting the new behaviour.** `openspec/specs/pipeline-union-op/spec.md:147-179`, "Requirement: Analyze flags a timestamp-versus-numeric field collision in a union", says the check runs only when the secondary is resolved "(`lane`-kind)". It also says "When the secondary schema is not resolved (including every `source`-kind secondary — a known gap), no error is reported". Its scenario "A source-kind secondary is not checked" (`:177-179`) requires "no `validationError` … whatever the source's field types (known gap)".
   - This change's `specs/pipeline-union-op/spec.md` modifies only the passthrough requirement. After archive sync, the main spec would require both that a source union errors and that it never errors. AC5 is not met.
   - Add a `MODIFIED` block for this requirement:
     - The secondary is resolved for `lane`-kind, or for `source`-kind with a non-empty inferred schema.
     - Replace the "not checked" scenario with a source-kind collision scenario, plus one for an unresolvable source (empty id, missing source, or empty inferred schema) where no error is reported.
2. **A second live spec scenario contradicts the change, and its capability is not listed.** `openspec/specs/pipeline-analyze-api/spec.md:189-192`, in "Requirement: Analyze projects a schema per node, including every tail" (`:173`), has the scenario "A source-kind secondary input falls back to best-effort projection". It says a `source`-kind union's projection is "the parent lane's schema unchanged" and that "the secondary data source's schema is not resolved".
   - Add `pipeline-analyze-api` to the proposal's Modified Capabilities.
   - Add a `MODIFIED` delta for that requirement, in which a source-kind union appends the secondary-only fields when the inferred schema resolves and passes through only when it does not.
3. **The agent-facing MCP tool text goes stale.** `helio-mcp/src/tools/write.ts:462-464` (the `add_pipeline_step` description) tells agents that the union "output schema is a best-effort passthrough of the input schema — verify the union's actual shape with preview/run rather than trusting the analyzed schema".
   - After this change that is false for any union whose secondary resolves. It was already false for lane unions; this change makes the source case false too.
   - Add a task to correct this text. `write.ts` is not in PR #986's file list.
   - Widen task 1.2/1.3 from "grep for a local union schema projection" to "grep for every statement that a union's analyze is passthrough or that its source secondary is unresolved". The sweep should cover `backend/src`, `helio-mcp/src`, `docs/` and `openspec/specs/`, and the executor should record the hits. Known hits:
     - `write.ts:463`
     - `pipeline-analyze-api/spec.md:189-192`
     - `pipeline-union-op/spec.md:41,154,177-179`
     - `MultiInputSchemaInference.scala:55-62`
     - `PipelineAnalyzeService.scala:201-203,252-254,305-307`
     - `PipelineServiceSupport.scala:91-99`
     - the test comment at `PipelineCreateInlineSourceCleanupSpec.scala:110`
4. **The change to Output-mapping validation on the write path is not stated.** `validateOutputFieldMapping` (`PipelineServiceSupport.scala:65-85`) checks an Output's `fieldMapping` columns against the node's projected schema (`OutputBindingSpec.validateFieldMappingColumnsExist`). It is called on:
   - the transactional create path (`PipelineCreateTransaction.scala:266-268`, where a failure is a `400`)
   - the proposal-analyze path (`PipelineProposalAnalyze.scala:149`, where it sets a per-Output `validationError`)

   Today, mapping an Output at or below a source-kind union to a column that only the source carries is rejected. After this change it will be accepted. That is a widening, and arguably a fix, but it changes what `POST /api/pipelines` and `analyze-proposal` accept, and AC1 names "transactional create" explicitly.
   - Add this to the design's "Cost the owner should weigh" paragraph and to the risks.
   - Add a test that is red on the base commit: a `POST /api/pipelines` or analyze-proposal Output mapping a source-only column below a source union, rejected on base and accepted after the change.

### Non-blocking notes

- The design's non-goals list omits `openspec/specs/pipeline-analyze-schema-warnings/spec.md`, which PR #986 also edits. No hunk is shared: this change's `MODIFIED` block is "Missing referenced field warns", which #986 does not modify. Still, list the file so whoever merges second knows the archive-sync step touches a file #986 also touches. The archived `MODIFIED` block is a copy of the requirement on the current base, so check it again after a rebase.
- The requirement title "Union op analyze-inference is a documented best-effort passthrough" no longer describes the behaviour. Consider an OpenSpec `RENAMED` entry, or at least note it in the PR's owner-review section.
- AC1 says "every analyze path". The plan's single seam test (2.4) covers one persisted path; the other four rely on the shared resolver. The grep evidence for that is adequate, but a second assertion through `capabilities?stepId=` (`PipelineNodeReads`) would cover the picker path the owner will actually see.
- Task 2.4: use throwaway `@example.test` users and delete them by exact (id, email) with `buildUserDeleteSql`, as the binding rules require.
