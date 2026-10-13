## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc (equal to origin/main; change dir untracked). The spawn-cwd guard
returned READY.

### What I verified (with evidence)

- **Premise items 1, 2, 4, 5 hold at HEAD.**
  - `PatchSetTargetFingerprint.scala:55-62`: OutputDelete hashes `{name, config}` and PipelineStepDelete hashes `stepState`.
  - `PatchSetPreviewImpact.scala:20` has the static `PipelineDeleteCascadeHint`.
  - The only caller of `rewriteUpsertTargetAction` is `DataSourceRepository.scala:501`, so D8's "real run write path" exists.
  - `updateSchemaInternal` is real (`OutputRepository.scala:262`, called from `PipelineRunSucceededWrites.scala:146`).
  - Latest migration is V130 on both HEAD and origin/main, so V131 is free.
- **D1 (no change to update fingerprints).** Holds by construction: `PatchSetTargetFingerprint.of` projects only the
  allowlisted keys that are present in the state, so update arms that lack the new keys hash exactly as they do today.
- **D2 (shared Output projection).** Sound. `PatchSetPipelineDefinition.scala:36-47` is the only place that builds
  per-Output `panelIds`/`alertRules` today.
- **D3 (removed set matches `deleteInternal`).** The rule as written matches `PipelineStepRepository.scala:982-1013`: the
  target, plus each child after the head (by position) with all its descendants, while the promoted head survives. There
  is a determinism gap, though (CR3). `childrenSorted` is sorted by `position` only (line 990), and the HEL-911 note at
  ~line 1060 says 2+ siblings with `position == 0` are now allowed. Which tied child is the "head" therefore depends on
  the order the database returns rows in.
- **D4 (privacy).** Implementable with existing reads. `AlertRuleRepository.findByIdOwned` / `findAll(ownerId)` and
  `PanelRepository.findById(id, Some(user))` are caller-scoped. The named-vs-counted rule is in both the spec and the design.
- **D5 (claim/release).** Read `PatchSetApplyService.scala:79-163` and `PatchSetApplyRollback.scala`:
  - Apply is not one DB transaction. Each edit is written through a service, and a failure is compensated afterwards.
  - Rollback can report an edit as `unrecoverable` (about 20 sites) or `recreated`.
  - `applyResolved` never returns `Left`. A mid-set failure returns `Right(failure=Some)`.
  - A failed Future from `applyOne` (an exception) skips rollback entirely. A failed Future from `journalSuccess` happens
    after every edit was applied.

  Consequence: "release on failure.isDefined, a Left, or a failed Future" can release the claim while the created
  resources still exist (CR2).
- **D6 (minting is stable across reload).** I traced where each surface reads its patch set from:
  - **Refinement drawer:** `RefinementChatDrawer.tsx:97-100` reloads from the server-stored `view.latestPatchSet`, which
    `RefinementConversationTurns.scala:59,87` writes from what `parseAndValidate` returns. Minting there is stable. OK.
  - **Assistant hand-off: broken.** `ActiveConversationPanel.tsx:160` calls `extractProposal(transcript)`. That function
    (`proposalExtraction.ts:37-60`) returns the model's raw `tool_use.input`, and `ProposalHandoff.tsx:48,61` navigates
    with exactly that object. `AssistantToolExecutor.capturedProposal` (line 331) is never read by the UI. Grep finds
    only `ActiveConversationPanel` consuming proposals, both live and after reload.

  So an id minted in `executeProposePatchSet` never reaches the review page. Worse, a model-supplied `proposalId` in
  `tool_use.input` would pass straight through (CR1).
- **Schema drift gate.** `scripts/check-schema-drift.mjs:717-719` compares the `PatchSetSchema` tool schema
  (`AssistantProposalToolSchemas.scala`) against `patch-set.schema.json` and requires them to be set-equal. The design
  adds `proposalId` to the JSON schema only, so `check:schemas` would fail (CR4).
- **MCP is unaffected.** `helio-mcp/src/tools/refinementSchemas.ts:44` is a plain (non-strict) zod object, so it strips
  `proposalId`. MCP applies keep their current behaviour, as the Non-goals section claims.
- **Coverage.** Every AC maps to a task except AC7 (filing the Follow-up ticket for items 6-7), which has no task (CR5).

### Verdict: REFUTE

### Change Requests

1. **D6 / task 3.4 / spec "server-minted proposalId": the assistant path does not reach the review page.** The assistant
   hand-off and its reload both read the patch set from the persisted transcript's `tool_use.input`
   (`frontend/src/features/assistant/proposalExtraction.ts:37-60`, `ProposalHandoff.tsx:48-61`), not from
   `capturedProposal`. Revise D6 and the tasks to say where the minted id is persisted so the frontend reads it, and add a
   frontend task for it. Two options:
   - Put `proposalId` in the `propose_patch_set` tool_result body. It is persisted in the transcript blob. Then have
     `extractProposal` (or `ProposalHandoff`) overwrite `input.proposalId` from the paired `tool_result`.
   - Rewrite `tool_use.input` in the stored history.

   In either case the frontend must ignore or drop any model-authored `proposalId` in `tool_use.input`. Otherwise a model
   that repeats an earlier id would make a new proposal read as "already applied".

   Also, task 4.8's "stored copy equal" test needs a frontend/seam half: assistant transcript → hand-off → apply body
   carries the server id. Add a test that re-extracts from a reloaded transcript.

   Finally, the model must not be able to fail `propose_patch_set` with a non-UUID `proposalId`.
   `executeProposePatchSet` decodes with the same format that D5 makes 400 on a non-UUID. Strip the field before the
   UUID check, or validate the UUID only at the apply route.
2. **D5: the release conditions can re-enable a double apply.** Releasing on "a failed Future" is unsafe in two places.
   An exception from `PatchSetApplyForward.applyOne` skips rollback entirely, so earlier edits stay applied. A failure in
   `journalSuccess` comes after every edit was applied. Releasing on any `failure.isDefined` is also unsafe when rollback
   reported an edit `unrecoverable` (`PatchSetApplyRollback.scala`), for example a create whose compensation failed.

   Specify that the claim is released only when one of these holds:
   - the apply is refused before any write, or
   - the apply returns `Right(failure = Some)` and every rolled-back outcome is a clean rollback (no `unrecoverable`).

   In every other case keep the claim and log it, failing toward "never double apply", which the Risks section already
   accepts. Add a test that forces an `unrecoverable` rollback and shows the id stays consumed.

   Separately, reword the patch-set-apply spec's "record that id as applied … only when the apply succeeds". Under
   claim-before-write, the id is held while the apply is in flight: a concurrent second apply gets 409 even if the first
   later fails and releases. State that explicitly so the spec does not contradict D5.
3. **D3: make the removed-set rule deterministic.** Order children by `(position, id)` in the shared pure function and
   in the query that feeds it, for both `deleteInternal` and `removedByDeleteInternal`.

   Today `deleteInternal` sorts by `position` only (`PipelineStepRepository.scala:990`), and siblings with tied
   positions are permitted (HEL-911). With ties, the preview's read and the delete's read can pick different heads. The
   fingerprint would then cover a different set than the one actually deleted, and two previews could spuriously
   disagree.

   Making the tie-break explicit removes this nondeterminism without changing any behaviour where positions differ.
   Record that in the design, and add a tied-position test asserting the fingerprinted set equals the deleted set.
4. **D6 / task 3.2: the tool schema must change too.** `scripts/check-schema-drift.mjs:717-719` requires `PatchSetSchema`
   in `AssistantProposalToolSchemas.scala` to have the same properties as `patch-set.schema.json`. Add `proposalId` there
   with a "Server-assigned. Omit; any value sent is discarded." description, mirroring `fingerprint`, and list
   `check:schemas` in task 4.10's gates.
5. **AC7 has no task.** Add a task to file the Follow-up ticket for items 6-7. Label it Follow-up and set relatedTo
   HEL-1522, per the repo's follow-up labeling convention. Note in it that MCP applies do not carry `proposalId` (Risks
   section).

### Non-blocking notes

- **Is apply-once a product call?** Mostly no. Ticket item 3 names double apply as a defect, and the uniform rule adds
  nothing new for update/delete sets: after a successful apply, their fingerprints already 409. Undo is the exception.
  "Undo does not release the `proposalId`" (the spec) is a user-visible choice the ticket does not settle: undo then
  re-apply the same proposal is a plausible flow. It is conservative and reversible, so it does not need an owner ruling
  before execution, but list it explicitly in the PR body as an owner-reviewable assumption, not as self-approved.
- **D4:** pin "alert rule visible to the caller" to owner-scoped (`findAll(ownerId)` / `findByIdOwned`), and resolve
  panel names in one batched caller-scoped read rather than one query per panel.
- **D5:** the claim insert and release must use `withUserContext(owner)` like `PatchSetApplicationRepository`. The
  FORCE RLS policy will otherwise refuse the insert or delete silently. Test this on the RLS-on path if one exists, and
  check MISTAKES.md's RLS parity entry.
