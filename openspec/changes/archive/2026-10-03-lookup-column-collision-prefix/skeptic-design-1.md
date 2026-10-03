## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Brought value wins on main: LookupStep.scala `leftRow ++ brought` (matched) and `leftRow ++ nulls` (unmatched, null overwrites left). Claim true.
- inferLookup (PipelineAnalyzeService.scala ~999-1020): per-column `schema.filterNot(_.name == col) :+ SchemaField(col, type)`; mirrors runtime. Claim true.
- Spark has no lookup: `grep -i lookup backend/.../spark` empty; SparkJobSubmitter only uses JoinColumnNaming for join. True.
- Names are config-declared: runtime `columns` and analyze `columns` come from the same config, so source-kind secondary pre-resolution is unnecessary for names. `sourceDependencyOf` (line 232/286) is join-only today; lookup gets secondary schema only for lane-kind; unchanged. Sound.
- resolveWithKey preserves resolve: current resolve's key-drop is `left.contains(joinKey)` on `c == joinKey`; delegating `resolve = resolveWithKey(.., Some(joinKey))` is identical. Lookup passing Some(lookupKey) only when sourceKey==lookupKey, drop still gated on left carrying it. Key-drop reasoning is correct (matched rows equal by construction; sourceKey != lookupKey keeps it ordinary). Also fixes null-overwrite of the key on unmatched rows.
- Contract delta: REMOVED/MODIFIED requirement headers match openspec/specs/pipeline-lookup-op/spec.md lines 54 and 64 exactly. ADDED requirements cover collision, key, parity.
- Existing tests asserting overwrite located (InProcessPipelineEngineSpec:1180, PipelineAnalyzeServiceSpec:169) and covered by task 2.4. Other consumers (PatchSetPreviewProjectionSteps, ProvenanceService, PipelineCostEstimator, frontend stepNarrowing, helio-mcp) only reference the config/op, no column computation seen; task 2.5 re-greps.
- All ACs map to tasks: red-first 1.1, green/parity 3.1, mutation 3.2, secondarySourceSchemas/Spark/key semantics in design Decisions 3,7,8, dev-DB inventory 3.3. No placeholders/TBDs, no contradictions, no scope drift.

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.1 "right_x on right" is ambiguous for a config-declared right side; clarify as "requested columns include `right_x` alongside `x`" (expect x -> right_x_2, right_x unchanged).
- Mutation task 3.2 should note the mutation must be placed in the shared core (resolveWithKey) so it is red for both, and that the red-first test (1.1) must be run before touching LookupStep.
- Analyze type lookup keyed by original requested name (secondaryTypes) must stay keyed by original, not renamed name; add an assertion in the lane-kind parity case.
- Runtime empty-left-input divergence (analyze schema still renames) is documented in Decision 2; keep it in the PR body.
