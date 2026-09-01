## Skeptic Report — final gate, dimension 2: proposal/patch-set contract, both sides (round 1)

Cold review. Every conclusion below is derived from the files/commands named, not from
`execution-progress.md` / `files-modified.md` / `evaluation-*.md` (read only as claims).

### What I verified (with evidence)

**Gates re-run by me, in this worktree**

- `node scripts/check-schema-drift.mjs` → exit 0, twice (reproduced).
  `schemas in sync with JsonProtocols (73 checked across 48 protocol files)`,
  `panel-type enums in sync (7 surfaces)`. Genuinely green.
- Scoped helio-mcp jest (the ticket's verified command, `/dist/` excluded):
  **18 suites / 182 tests passed, 2.9s, no OOM**, including `write.test.ts`,
  `pipelineProposalHandlers.test.ts`, `outputsHandlers.test.ts`.
- `cd helio-mcp && npx tsc --noEmit` → exit 0.

**Per-node grounding (task 1.4) — LANDED, and the tests discriminate**

- `PipelineService.createTransactional` computes `PipelineAnalyzeService.analyzeNodes(req.steps, dataSource.inferredSchema)`
  outside the DBIO chain and threads it plus `dataSource.inferredSchema` into `buildOutputsAction`
  (`PipelineService.scala:152-171, 266-296`). Per-Output schema selection:
  `nodeClientIdOpt.flatMap(analyzedNodes.get).map(_.outputSchema).getOrElse(sourceSchema)` — the
  source-attached (`nodeStepClientId` absent) arm is real, not planned-only. An unresolvable
  `nodeStepClientId` is rejected earlier (`:283-287`), so the `getOrElse` fallback cannot silently
  swallow a bogus node id.
- New `OutputBindingSpec.validateFieldMappingColumnsExist` checks mapping VALUES against the node
  schema, distinct from the pre-existing key/slot check; both run, ordered.
- `PipelineCreateTransactionalSpec` (real embedded Postgres + Flyway, not mocks) adds three tests
  that are mutually discriminating: the SAME `fieldMapping` (`value→amount`, `label→label`) is
  REJECTED on a tail behind `select[amount]` and ACCEPTED when attached to the raw source in a
  request that still contains that narrowing step — a trunk-schema implementation could not pass
  both. Third test rejects a source-attached mapping naming a column absent from `inferredSchema`.
  This AC is met.

**Dashboard-proposal half already retargeted by HEL-904 — TRUE, verified independently**

- `git log --oneline -- schemas/dashboards/dashboard-proposal.schema.json` → last change
  `2ec2a5bc HEL-904`; same for `DashboardProposalService.scala`.
  `git merge-base --is-ancestor 2ec2a5bc main` → true. Not a git-log-narrative artifact: the file
  contents themselves carry the retarget (`DataPanelKinds = Set("output")` at
  `DashboardProposalService.scala:159`; the schema documents `dataTypeId` as "actually an Output id
  … kept for schema stability"). The executor's cycle-10 conclusion is correct.

**Both-sides lockstep (design.md D4) — holds for the pipeline-proposal contract**

- `schemas/pipelines/pipeline-proposal.schema.json` drops `outputDataTypeName`, `$ref`s
  `create-pipeline-transactional-{step,output}-request.schema.json`, adds optional `outputs`.
- Backend `PipelineProposal` (`PipelineProposalProtocol.scala:114-119`) matches exactly
  (`outputs: Vector[...] = Vector.empty`).
- MCP `pipelineProposalInputSchema` (`pipelineProposal.ts:85-93`) mirrors it, dropping the
  `write.ts` `boundPipelineStepSchema` import; `types.ts:721-726` declares `outputs?` OPTIONAL —
  correct for spray-json's omit-`None` behavior (no `=== null` checks exist in any of the four
  MCP contract files; I grepped).
- `CombinedProposalService.resolveSentinelOutputId` correctly generalizes from "the one output" to
  zero/one/many with an explicit 422 rather than a silent guess.

### Verdict: REFUTE

Three defects, all in code this branch authored or edited, all in this dimension.

### Change Requests

1. **The only test naming HEL-766 does not exercise the fixed code, and its key assertion passes
   vacuously.** The fix is in
   `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala:297-311`
   (`fullPipelineStepInverse` + `pipelineStepCreateRequestFromPrior`, now threading
   `enabled`/`parentStepId`) — the fix itself is real and correct, and matches the request types
   (`CreatePipelineStepRequest` has both fields; `UpdatePipelineStepRequest` has only `enabled`).
   But the regression test added with it,
   `PatchSetUndoServiceSpec.scala:400` ("restore a pipelineStep delete edit by recreating it under
   its original parentStepId … (HEL-766)"), drives `PatchSetUndoService`, whose
   `restorePipelineStepDelete` (`PatchSetUndoService.scala:242`) calls
   `PatchSetUndoInverse.pipelineStepCreateRequestFromResponse` — a *different* builder, in a
   *different* file, which sets **no** `parentStepId` at all (`PatchSetUndoInverse.scala:136-145`;
   the executor's own cycle-4 note in `execution-progress.md` says exactly this and defers it).
   The assertion `recreated.parentStepId shouldBe Some(trunkStep.id)` nonetheless passes because
   `addStep` with `parentStepId = None, position = None` anchors on `trunkOf(current).lastOption`
   (`PipelineService.scala:957-983`) — and after the branched step is deleted, trunk-last IS
   `trunkStep`. The test would pass identically with the HEL-766 fix fully reverted.
   `grep` confirms **no** test anywhere reaches
   `PatchSetApplyRollback.compensatePipelineStepDelete`: the only `pipelineStep` `delete` edits in
   the suite are in `PatchSetUndoServiceSpec` (undo path) and `PatchSetPreviewServiceSpec`
   (preview path). Neither `enabled` nor `parentStepId` preservation through the *rollback* path
   has any coverage. This fails the ticket AC "Patch-set undo test covering add/remove/modify of a
   PipelineStep (`enabled` preserved through rollback/recreate — the real HEL-766 target)".
   Required: add a test that drives `PatchSetApplyService.apply` with a `pipelineStep` `delete`
   edit followed by a failing edit (the file's established forward-apply-only-failure trick, see
   `PatchSetApplyServiceSpec.scala:126-129`), on a step that is (a) `enabled = false` and (b)
   branched off a non-trunk-last parent, asserting BOTH fields survive compensation. Make the
   parent choice such that the default trunk-append would give a *different* answer, or the new
   test inherits the same vacuity. Verify it fails with the two field assignments reverted.

2. **`apply_combined_proposal`'s tool description instructs agents to use panel `type` values that
   no longer exist**, in lines this branch edited.
   `helio-mcp/src/tools/combinedProposal.ts:61-63` still reads: set the sentinel as the
   `dataTypeId` of "(metric/chart/table/collection/timeline panels)". The tool's own
   `panelSchema` is `z.enum(PANEL_TYPES)` with `PANEL_TYPES = ["text","markdown","image","output"]`
   (`proposal.ts:44,62-64`) — every one of those five kinds is rejected by zod before a request is
   ever made. This is the identical defect class the executor found and fixed in
   `RefinementEditShape` in cycle 5 ("every one would have been REJECTED by the real backend");
   the class was not enumerated (ticket lesson #2). Required: replace the enumeration with
   `output` panels (the only data panel kind), and grep the remaining MCP/backend prompt+description
   surfaces for the same stale kind list.

3. **The `config.dataTypeId` sentinel arm is now a silently-inert binding that this ticket's own
   rewrite kept alive and still advertises.** `CombinedProposalService.configIsBlessed`
   (`CombinedProposalService.scala:161-168`) blesses `config.dataTypeId` only for panels *outside*
   `DataPanelKinds` — which since HEL-904 is `Set("output")`, i.e. only `text`/`markdown`/`image`.
   But those kinds' configs carry no data binding at all: `dashboard-proposal.schema.json` (line
   104) says "a `config.dataTypeId` on a text/markdown panel is silently inert, not a binding
   attempt", and this ticket's own `proposal.ts:144-146` tells agents the same. So the arm resolves
   the sentinel into a slot that is guaranteed to do nothing — and worse, `panelReferencesSentinel`
   feeding `resolveSentinelOutputId` (`:150-158`) will 422 and roll back an entire pipeline+dashboard
   apply because of a sentinel that could never have bound anything. Meanwhile
   `combinedProposal.ts:62-64` actively instructs agents to put it there ("a non-data panel, e.g.
   text/markdown"), directly contradicting `proposal.ts:144-146` in the same ticket. Required:
   decide one way — either drop the `config.dataTypeId` arm (and its guidance) now that no
   non-`output` kind can bind, or state and test what it is supposed to mean — and make the two tool
   descriptions agree. Whichever is chosen, cover it with a test; there is currently none for a
   text/markdown-config sentinel.

### Non-blocking notes

- `pipelineProposal.ts:110` still describes "the canonical Source → Pipeline → **DataType** → Panel
  path" in `propose_pipeline`'s description — stale prose in a line this branch rewrote around
  (ticket lesson #5 asks for no such hits in new/changed code). Cosmetic vs. CR2, which changes
  behavior.
- The cross-owner ACL fix (`PipelineService.validateStepCrossOwnerRefs`, `:200-224`) is **real and
  correctly placed** — it covers `join.rightDataSourceId`, `union.otherDataSourceId`,
  `lookup.referenceDataSourceId` (with the empty-string carve-out matching `addStep`), runs before
  the transaction, and closes a genuine gap in HEL-906's `buildStepsAction`. But it has **zero
  direct test coverage**: `grep` finds no test asserting a cross-user right-source is rejected on
  `POST /api/pipelines`, and `CombinedApplyProposalSpecBase`'s `otherUserSourceId` fixture is
  declared but referenced by no spec. The old `addStep` path has six such tests
  (`PipelineStepRoutesSpec.scala:455-533`). The claimed evidence — a pre-existing rollback test that
  "started failing" — proves the path is reached, not that the ACL decision is correct. I am
  recording this as a note rather than a CR because the fix is defence-in-depth beyond the ticket's
  ACs and reads correctly, but a security-relevant check with no test asserting its security
  property is one refactor away from silently regressing; a follow-up ticket or a three-line test
  mirroring `PipelineStepRoutesSpec`'s "cross-user right-source returns 404" would close it.
- `PatchSetUndoInverse`'s inability to thread `parentStepId` (needs a `PipelineStepResponse` wire
  change) is honestly documented and deferred — but note it means the *undo* path still silently
  re-parents branched steps whenever the default trunk-append happens to differ. Worth confirming
  the follow-up ticket exists (ticket lesson #4).
