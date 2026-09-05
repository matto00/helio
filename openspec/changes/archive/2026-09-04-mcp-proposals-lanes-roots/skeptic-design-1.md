## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Ground-truth "already shipped" table (design.md).** Checked every citation against the tree at
   `0f16b85d`:
   - `helio-mcp/src/tools/pipelines.ts:53-58` — comment confirms `roots[]`/`rootClientId` reuse. Confirmed.
   - `PipelineService.scala:467-472` (lane `secondaryInput` rewrite) and `:560` (call site) — confirmed
     present, matches claim.
   - `PipelineService.scala:776` (`addRoot`), `:817` (`removeRoot`) — confirmed present, and
     `mcp-pipeline-root-tools` MCP wiring (`add_root`/`remove_root`) confirmed in `pipelines.ts`/
     `pipelinesHandlers.ts`.
   - `PipelineService.scala:1982-1985` — `rootAddress`/`stepAddress`/`outputAddress`/`joinAddress`
     confirmed present verbatim, with a doc comment explicitly saying "HEL-914 inherits this format."
   - `PipelineAnalyzeProtocol.scala:190-203` — confirmed `sourceSchemas: Vector[RootSourceSchemaResponse]`
     and the `sourceSchemaDrift` primary-root-only scoping comment, matching the claim exactly.
   - `helio-mcp/src/context.ts:324` (`roots` array on workspace-context pipeline entries) confirmed.
   - `PatchSetPreviewProjection.scala` confirmed to reuse `CreatePipelineRootRequest` and loop over
     `request.roots`, matching the "inherited HEL-913's shape incidentally" claim.
   All seven "already shipped" citations check out. No under-scoping found here.

2. **D1's corrected "8 not 9" site list.** Verified `PatchSetApplyRollback.scala`, `PatchSetUndoInverse.scala`,
   `RefinementEditShape.scala`, `PipelineShapeProtocol.scala` contain zero occurrences of
   `PipelineProposalSource` — confirmed no real logic references it. Verified `PatchSetProtocol.scala:35`
   (renumbered slightly but present, doc-comment-only mention at line 55 area) and
   `PipelineProtocol.scala:55` both only mention `PipelineProposalSource` in a doc comment, never consume
   it. Claim holds.

3. **AC3's "MCP result cap" absence.** Grepped `helio-mcp/src` for any response-size/byte cap; found none.
   The only cap present is the unrelated 1000-row `RunOutcome.truncated` in `helioApi.ts`/`types.ts`, exactly
   as design.md states. Confirmed AC3 was written against a cap that never existed, and D6 introduces one
   with two tests (within-budget concise / over-budget full) — sound.

4. **D2's `PipelineProposalSource` vs `CreatePipelineRootRequest` argument.** Confirmed both requirements
   exist in the canonical spec at the cited lines: "Inline REST source may propose a not-yet-existing
   Connector" at line 83 and "Structural validation accepts an unresolved newConnector draft" at line 111
   (`git show 0f16b85d:openspec/specs/pipeline-proposal-contract/spec.md`). Both describe `csv`/`newConnector`
   capability that `CreatePipelineRootRequest` does not carry (confirmed via `PipelineProtocol.scala:52-58`,
   which documents `csv` as deliberately excluded from the create-path inline shape). The argument holds, and
   the delta correctly leaves these two requirements untouched (still valid per-root under D2's "reuse
   unchanged" decision) rather than rewriting them unnecessarily.

5. **D3's `EditTarget`/`PatchSetProtocol.scala:25-29` claim.** Read the file directly — lines 25-29 verbatim
   state the `output`-create gap is because "`CreateOutputRequest` carries no parent-pipeline-id field...
   and `EditTarget` has no field for one." Exact match to the design.md claim, including line numbers.

6. **Spec-delta content vs canonical originals (`pipeline-proposal-contract`, `pipeline-proposal-apply`).**
   Diffed both deltas against HEL-913's abandoned drafts at
   `.concertino/runs/HEL-913/evidence/.../specs/`. HEL-913's drafts were materially thinner: they omitted
   the `MODIFIED Requirements` block for "PipelineProposal schema shape" entirely (never updating the
   top-level `required` list away from the old `source`-based one) and had far fewer scenarios (no rollback
   scenario naming the first root's created source, no per-node grounding requirement at all, no lane-related
   ADDED requirement). This run's deltas are substantially more complete and correctly superset HEL-913's
   draft — confirms the "same defect class, now fixed" framing in the ticket is accurate.
   Also confirmed the delta's `MODIFIED "PipelineProposal schema shape"` requirement correctly drops
   `outputDataTypeName` from the required-field list — this is NOT a scope-creep drop of a still-live
   scenario; `outputDataTypeName` was already removed from the real schema/protocol in HEL-907
   (`schemas/pipelines/pipeline-proposal.schema.json`'s `required` is currently `[pipelineName, source,
   steps]` — no `outputDataTypeName`), so the canonical openspec text was already stale before this ticket
   and the delta happens to correct that drift as a side effect. Not flagged in design.md, but harmless and
   correct — non-blocking note only.
   `openspec validate mcp-proposals-lanes-roots --type change` passes.

7. **AC traceability.** All four ticket ACs map to explicit spec scenarios and tasks: AC1 →
   `mcp-pipeline-lane-tools` "one create_pipeline call..." + task 7.2; AC2 → `pipeline-proposal-apply`
   grounding/undo requirements + tasks 4/5.6-5.8; AC3 → `pipeline-analyze-api`/`mcp-pipeline-lane-tools`
   concise-mode requirements + task 6.5; AC4 → task 6.7 (tool-name test) + task 6.9 (docs example run).

### Verdict: REFUTE

### Change Requests

1. **`mcp-pipeline-proposal-tools` spec delta is incomplete — it only ADDS, never MODIFIES, requirements
   that will become false.** The canonical spec's existing requirements ("propose_pipeline assembles and
   validates without writing," "apply_pipeline_proposal applies atomically...") and their scenarios are
   written entirely against the singular `source` field (e.g. "an agent calls `propose_pipeline` with a
   `pipelineName`, a `source` referencing an existing caller-owned `sourceId`..."). This ticket removes
   `source` outright with **no alias** (proposal.md: "BREAKING... removed outright"). After this change
   ships, every one of those pre-existing scenarios is false — the tool no longer accepts `source` at all,
   it rejects it. proposal.md lists `mcp-pipeline-proposal-tools` under "Modified Capabilities," but the
   spec delta at `specs/mcp-pipeline-proposal-tools/spec.md` contains only an `## ADDED Requirements`
   section with a brand-new requirement; it never touches the stale bodies. `openspec validate` does not
   catch this because nothing was removed or renamed — the old scenarios simply sit alongside the new one,
   contradicting it. **Required fix:** add a `MODIFIED Requirements` block (or `REMOVED`+`ADDED` pair,
   matching the `pipeline-proposal-contract` delta's own pattern) that rewrites the `source`-based
   scenarios in "propose_pipeline assembles and validates without writing" and
   "apply_pipeline_proposal applies atomically..." to use `roots[]`, including a scenario for the
   client-side rejection of a `source`-carrying proposal (this scenario already exists in the *new*
   requirement, so the fix is to retire the old `source`-based scenarios from the *old* requirement, not
   duplicate coverage).
2. Add a task to tasks.md section 6 (or a new 6.x) explicitly covering the `mcp-pipeline-proposal-tools`
   spec-body rewrite from item 1, so it isn't dropped between design and execution — currently no task
   references updating that capability's existing requirement text, only the ADDED one.

### Non-blocking notes

- The `pipeline-proposal-contract` MODIFIED requirement silently drops `outputDataTypeName` from the
  required-field list. This is correct (matches already-shipped HEL-907 reality) but is an unremarked
  side-effect of an otherwise roots-focused delta; a one-line callout in design.md would save a future
  reviewer the trip to re-derive why it's safe.
- `proposal.md`'s Impact list names `PatchSetApplyRollback`/`PatchSetUndoInverse`/`PatchSetPreviewProjection`/
  `RefinementEditShape`/`PipelineShapeProtocol` as impacted files, which at first read appears to conflict
  with design.md §D1 excluding them from the "correlated surface." On inspection these are legitimately
  touched for the new lane-edit patch-set feature (task 5.6-5.8), a different reason than D1's narrower
  "consumes proposal source" test — not a contradiction, but worth a one-line disambiguation in proposal.md
  since the two documents currently read as competing claims about the same file list.
