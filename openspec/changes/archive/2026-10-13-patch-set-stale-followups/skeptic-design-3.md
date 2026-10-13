## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc. The change dir is untracked, and `origin/main` has not advanced
past HEAD (`git log HEAD..origin/main` is empty after a fetch). The spawn-cwd guard returned
`READY ambient=/home/matt/Development/helio branch=task/patch-set-stale-check-followups/HEL-1522`.

I judged the artifacts as they stand now against the live tree. The round-1 and round-2 narratives were treated as
claims to check, not as findings.

### What I verified (with evidence)

**Round-2 change requests: each is addressed in the artifacts, and each fix is implementable on the live tree.**

- **CR1 (409 contract).** D5 and task 3.3 now specify:
  - a dedicated `ServiceError.PatchSetAlreadyApplied`;
  - its own `completeError` arm;
  - a wire type `PatchSetAlreadyAppliedResponse(message, code)`;
  - `schemas/shared/patch-set-already-applied-response.schema.json`;
  - a wire test (4.7b).

  This mirrors the existing analogue exactly: `ServiceError.PatchSetStale` (`ServiceError.scala:49`), with its arm at
  `ServiceResponse.scala:88` and its status at `:116`, plus `schemas/shared/patch-set-stale-response.schema.json`. The
  frontend tells 409s apart by `data.code` (`patchSetsSlice.ts:257-258`), which is why this matters.
- **CR2 (third splice copy).** D3 and task 1.2 now name `PatchSetPreviewRemovals.removedStepIds`. Its
  `.sortBy(_.position)`-only rule is confirmed at `PatchSetPreviewRemovals.scala:47-52`. `deleteInternal` sorts by
  `position` only at `PipelineStepRepository.scala:990`. Test 4.7a asserts that all three paths agree under tied
  positions.
- **CR3 (UUID site).** D5, D6 and task 3.2 now agree: the field decodes leniently in the shared `patchSetFormat`
  (`PatchSetProtocol.scala:215`, used by preview, refinement and `propose_patch_set`), and the UUID check (400) runs on
  the apply path only.
- **CR4 (hint reads).** The plan names its reads:
  - panels through `PanelRepository.findById(id, Some(user))` (`PanelRepository.scala:141`, caller-scoped);
  - alert rules through `AlertRuleRepository.findAll(ownerId)` (`AlertRuleRepository.scala:57`);
  - a new required `alertRuleRepo` on `PatchSetApplyContext`.

  `PatchSetApplyContext` (`PatchSetApplyTypes.scala:98-111`) currently has no alert-rule repo, so the collaborator is
  needed. Construction is compile-enforced through `build` (lines 118-127; both services call it at
  `PatchSetApplyService.scala:74` and `PatchSetPreviewService.scala:41`). 27 files construct the two services
  (`grep -rln "new PatchSetApplyService\|new PatchSetPreviewService"`). Task 2.0 accepts "compile is the check", which
  is sound because the parameter has no default.

**Load-bearing premises I checked myself.**

- **Overlay order for AC3.** `PatchSetPreviewProjection.scala:65-67` computes the impact with the overlay from before
  this edit, and only then records this edit's removals. So `overlay.isRemoved("panel", id)` in the PipelineDelete arm
  reflects only earlier edits. The pipeline's own cascade does not suppress its own names.
- **Current fingerprint shape.**
  - `Allowlist` and `of` are at `PatchSetTargetFingerprint.scala:32-39` and `:90-94`. `of` projects only the keys
    present in the state, so D1's "update fingerprints byte-identical" holds by construction.
  - OutputDelete hashes `{name, config}` via the caller-scoped `findConfigById` (lines 57-60). D2 keeps that value.
  - `PatchSetPipelineDefinition.scala:22-23` already has `StepKeys` (including `parentStepId`) and `OutputKeys`
    (including `kind`/`nodeStepId`), and the schedule carries `enabled`/`timezone` (lines 56-59). So 4.4's tests cover
    fields that are already fingerprinted. 4.9's per-field mutation runs are the right evidence for them.
- **D5 release rule is implementable.**
  - `applyResolved` only returns `Right` (`PatchSetApplyService.scala:142-151`).
  - Rollback outcomes are `rolledBack`, `recreated` and `unrecoverable` (`PatchSetApplyRollback.scala:60-116`).
  - A failing pipeline-create's inline source is already cleaned up (HEL-1469, `PatchSetPipelineCreateOrphanSourceSpec`).
    So "every applied edit rolled back cleanly" does not miss a partial write by the failing edit itself on that path.
  - `withUserContext` runs `setUserVar andThen action` transactionally on the app pool (`DbContext.scala:50-51`), so
    the claim INSERT commits before the first write. The PK race-safety argument holds.
- **D5 table shape.** It follows V79's direct-owner `USING` policy with FORCE RLS. `ON DELETE CASCADE` on `users`
  means `e2e/support/userCleanupCore.cjs`'s `BLOCKING_OWNED_TABLES` (NO ACTION FKs only) needs no entry. V131 is free:
  the latest migration is V130, and no open PR touches `db/migration`, `patchsets`, `ServiceError`/`ServiceResponse`,
  `PipelineStepRepository` or `features/patchSets` (`gh pr diff --name-only` over every open PR).
- **D6 assistant path.**
  - `executeProposePatchSet` returns `preview.toJson.compactPrint` as the tool_result body
    (`AssistantToolExecutor.scala:332`), with no truncation in the assistant package.
  - `extractProposal` already builds `resultsByToolUseId` (`proposalExtraction.ts:40-47`) and reads `tool_use.input`.
  - `ProposalHandoff.tsx:61` navigates with that object.

  So "server id from the paired tool_result overwrites `input.proposalId`" is a local, well-defined change.
- **D6 refinement path.** `parseAndValidate` (`RefinementService.scala:122-132`) is the single choke point for the
  initial and repair attempts, so minting there covers both. The patch set reaches the review page unmodified
  (`RefinementChatDrawer.tsx:198`), and `stampFingerprints` spreads `...patchSet` (`stampFingerprints.ts:9`), so a
  top-level `proposalId` survives into the apply body.
- **MCP.** helio-mcp's `propose_patch_set` returns the `/api/refinements` body verbatim (`refinementHandlers.ts:24`), so
  MCP callers will now see a `proposalId`. Its apply input schema is non-strict and strips it, so MCP applies behave as
  before. This matches the Non-goals and Risks sections. No helio-mcp guard compares against `patch-set.schema.json`;
  it is only mentioned in a comment at `helio-mcp/src/types.ts:1172`.
- **Schema drift.** `check-schema-drift.mjs:717-719` requires the `PatchSetSchema` tool schema to be set-equal with
  `patch-set.schema.json`'s properties. Task 3.5 adds the field to both. The JSON schema is `additionalProperties:
  false` (line 21), so task 3.2's schema edit is required, and it is planned.
- **Spec deltas.**
  - `openspec validate patch-set-stale-followups --strict` reports `Change 'patch-set-stale-followups' is valid`.
  - The MODIFIED stale-check requirement keeps all five base scenarios (base spec lines 21-46). It qualifies "stable
    across a pipeline run" with the upsertsource exception and adds the new scenario, so AC6 is covered.
  - The preview MODIFIED requirement keeps both base scenarios.
  - The apply ADDED requirements state claim-before-write, release-only-if-no-write-survived, and concurrency
    "at most one applied". This is consistent with D5.
- **AC coverage.** AC1 → 1.3/4.1/4.3. AC2 → 1.2/1.3/4.2/4.3/4.7a. AC3 → 2.0/2.1/4.6. AC4 → 3.x/5.x/4.7/4.7b/4.8.
  AC5 → 4.4/4.5/4.9. AC6 → 1.4/4.5. AC7 → 6.1.
- **Scope.** Items 6-7 are deferred, and the deferral is recorded in ticket.md. Neither AC1-AC6 nor any task touches
  them, and C1 fences off `helio-mcp/`. No placeholders, TBDs or deferred decisions block implementation.

### Verdict: CONFIRM

The design is sound enough to execute. The remaining gaps below are small. Each one is caught mechanically by a
constraint already in the plan (C3's mutation runs, or CI's RLS guard), so none of them needs another design round.
They should be handed to the executor as explicit instructions.

### Non-blocking notes (hand these to the executor)

1. **Task 4.2 has no test that makes the `removedSteps` mutation in 4.9 go red.**

   Every case in 4.2 is a panel or alert-rule change on an Output, and the `outputs` key also catches those. Dropping
   `removedSteps` would therefore leave 4.2 green, and 4.9's "drop each new delete key → red" could not be shown for
   it.

   Add two step-delete change-then-409 cases:
   - a change to a removed tail step itself, such as its `config` or `enabled`, or a new child added under a tail
     root;
   - a sibling reorder that changes which child is the promoted head.

   Both are what AC2's "every step the delete removes" actually promises.
2. **Add the RLS and migration guard specs to 4.10's targeted gates.**

   Adding the V131 RLS table without updating `RlsPolicyGuardSpec`'s allowlist will fail its "allowlist completeness"
   test (`RlsPolicyGuardSpec.scala:286-291`, entries at about line 110). That spec lives in `infrastructure.persistence`,
   which 4.10's package list does not cover. Add the V131 entry and run `RlsPolicyGuardSpec` and
   `FlywayNonSuperuserMigrationSpec` locally.

   MISTAKES.md ("RLS policies never run in dev or CI") explains why: the `withUserContext` claim and release cannot be
   proven RLS-correct by the superuser test DB. State that limit honestly in the PR rather than implying it was tested.
3. **The refinement re-entry path for item 3 was not reproduced.**

   `handleReviewAndApply` clears the stored `conversationId` and `latestPatchSet` before navigating
   (`RefinementChatDrawer.tsx:195-202`), and the review page replaces history after a successful apply. So "re-entered
   from the refinement drawer" is at most a duplicated-tab or history-state path. The assistant hand-off is the
   clearly real path: `extractProposal` re-renders the latest successful proposal with no applied state.

   Minting in refinement is still cheap and correct. The PR body should not claim a reproduced refinement
   double-apply unless the executor actually shows one.
4. **Record a second D4 residual.** A panel that an earlier edit in the same set rebinds away from the pipeline's
   Output (a panel `config.outputId` update) would still be named as removed. A panel rebound onto one of its Outputs
   would not be named. Record this alongside the existing created-panel residual.
5. **Undo does not release `proposalId`.** As rounds 1 and 2 noted, list this in the PR body as an owner-reviewable
   assumption.
