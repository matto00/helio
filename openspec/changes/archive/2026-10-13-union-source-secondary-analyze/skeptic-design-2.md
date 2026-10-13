## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD `37311542aed346150f7eceda407be1560265f546` (planning artifacts untracked in the change dir). PR #986 checked live: OPEN, head `124e54fccf03192757e10c8cf9b780ebc1a0d55b`.

Scope: the ASSUMED PRODUCT CALL (analyze resolves a `source`-kind union secondary) is labelled, parked for owner review, and not judged here. Its rationale was re-checked against the tree and holds.

### What I verified (with evidence)

**Round-1 CR1 (union collision requirement contradicting the change): resolved.**
- The delta `specs/pipeline-union-op/spec.md` now carries a MODIFIED block for "Analyze flags a timestamp-versus-numeric field collision in a union". Resolution now covers "`lane`-kind, or `source`-kind whose data source has an inferred schema".
- The "A source-kind secondary is not checked" scenario is narrowed to unresolvable sources (empty id, missing or invisible source, no inferred schema).
- A new scenario covers the resolved source collision.
- Every canonical scenario of both union requirements is preserved. I compared them against `openspec/specs/pipeline-union-op/spec.md:38-58,147-179`. The passthrough scenario gains the "source has no inferred schema" qualifier, so it stays true.

**Round-1 CR2 (pipeline-analyze-api scenario): resolved.**
- `pipeline-analyze-api` is now listed under the proposal's Modified Capabilities.
- The delta reproduces the full requirement "Analyze projects a schema per node, including every tail". I checked it against canonical `pipeline-analyze-api/spec.md` (lines ~173-202):
  - all 6 original scenarios are present;
  - the source fallback scenario is narrowed to unresolvable sources;
  - a new "A resolved source-kind secondary input is projected" scenario is added.
- `inferUnion` (`MultiInputSchemaInference.scala:63-71`) does not depend on mode. That makes the mode-free `{a, b, c}` scenario correct for both byName and byPosition.

**Round-1 CR3 (stale MCP text and the sweep): resolved.**
- Task 1.4 now sweeps `backend/src`, `helio-mcp/src`, `docs/` and `openspec/specs/`, records each hit and its disposition, and lists the known hits, including `helio-mcp/src/tools/write.ts` ~L463.
- I re-ran an independent sweep (`grep -rniE` for union near passthrough/unresolved/best-effort). The hits were:
  - the `write.ts:463` text;
  - the `MultiInputSchemaInference.scala:55-62` doc comment;
  - the `pipeline-union-op` requirement title;
  - `PipelineAnalyzeServiceSpec.scala:146/151/1258`;
  - `frontend/src/features/pipelines/state/stepNarrowing.ts:751`.
- The spec hits at 146/151 test the linear `analyze` with secondary `None`, which stays true. The hit at 1258 is a lane test. The `stepNarrowing` hit is about config type widening, not schema.
- None of these is left uncovered in a way that would go stale.
- `write.ts` is not in #986's file list.

**Round-1 CR4 (write-path widening): resolved.**
- The design's "Cost the owner should weigh" paragraph, the Risks section and the proposal all state that `validateOutputFieldMapping` will now accept source-only columns below a source union.
- Task 2.5 requires a test that is red on base for this.

**Core mechanism re-verified.**
- `secondarySourceIdOf` (`PipelineAnalyzeService.scala:204-209`) covers join and lookup only.
- `sourceDependencyOf` (`:255-259`) covers join only.
- `processNode` (`:308-309`) tries the lane dependency first, then the source map.
- The only consumers of the two functions are:
  - `PipelineAnalyzeService.scala:309`
  - `AnalyzeSchemaWarnings.scala:97`
  - `PipelineServiceSupport.scala:104`

  So adding the `union` arms changes nothing outside analyze and the schema warnings.
- `resolveSecondarySourceSchemas` (`PipelineServiceSupport.scala:100-107`) drops empty or missing schemas (`.filter(_.nonEmpty)`), which gives AC3's passthrough.
- For `union`, `AnalyzeSchemaWarnings.scala:110` computes `in.names && sec.exists(_.flags.names)`. A source secondary gets `Flags(names=true, types=true)` (`:97`). Decision 2 therefore holds, and `AnalyzeSchemaWarnings.scala` (a #986 file) needs no edit.

**Schema-warnings delta.**
- I diffed it against the canonical "Missing referenced field warns".
- The only difference is the added scenario "A union with a resolved source secondary is name-complete".
- The requirement text is unchanged, and it stays correct: its "`union` whose secondary input schema could not be resolved" wording still holds.

**Round-1 non-blocking notes: all addressed.**
- The non-goals now mention #986's edit of `pipeline-analyze-schema-warnings/spec.md`.
- The rename is declined, with a reason, and left to the owner.
- Task 2.6 adds the capabilities-path assertion.
- Task 2.4 requires `@example.test` users.

**Other checks.**
- No placeholders or TBDs.
- Tasks, design and proposal agree.
- Every derived AC (1-6) maps to tasks: AC1 → 1.1, 1.2, 2.4, 2.6; AC2 → 2.1, 2.2, 2.4; AC3 → 2.1b, 2.2; AC4 → 2.3; AC5 → 2.1, 3.1, deltas; AC6 → C1, 2.7, non-goals.

### Verdict: CONFIRM

### Non-blocking notes
- After this change, the transactional create path calls `findByIdInternal` for a source-kind union's secondary. Today it does so only for join and lookup. The failure path becomes reachable from union steps too: a resolve failure fails the create, and the HEL-1469 inline-source compensation in `PipelineCreateInlineSourceCleanupSpec` handles it. This behaves exactly like join, so it is acceptable. The executor should still mention it in the PR's owner-review section, and should correct the `PipelineCreateInlineSourceCleanupSpec.scala:110` comment ("join/lookup only") as task 1.4 already lists.
- Task 2.5 offers "transactional create OR analyze-proposal". AC1 names transactional create, which is the `400` path. Prefer pinning the create path, or both.
- Task 2.1(a) and 2.2's reverse-collision case both need a mutation or base-red demonstration of their own. The mutation that removes `union` from `sourceDependencyOf` is the relevant one for projection. The one that removes it from `secondarySourceIdOf` is relevant for the seam and warnings tests. The executor should name which mutation reddens which test.
