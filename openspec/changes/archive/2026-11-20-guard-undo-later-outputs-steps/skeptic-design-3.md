## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed ticket.md, proposal.md, design.md, tasks.md and specs/patch-set-undo/spec.md against the live source at HEAD
763c69f6f77be04a57e6e5d208262f86c3fb86e0. The worktree is clean apart from the untracked change dir. Unless a path says
otherwise, it is under `backend/src/main/scala/com/helio/`. I judged the artifacts from source, not from rounds 1 and 2.
I checked separately that round 2's two change requests are resolved in the text.

### What I verified (with evidence)

- **The hole is real and sits where the design says.**
  - `PatchSetUndoBoundPanels.doomed`, `pipeline` arm: it lists Outputs (`listByPipelineInternal`), uses them only to find panels, then drops them.
  - `checkPipeline` (PatchSetUndoConflictCheck.scala, `checkPipeline`) compares `name` only, through `findByIdOwned`. There is no fingerprint comparison on this arm.
  - `ifStillUnbound` (PatchSetUndoService.scala:154-160) re-checks panels only.
  - So an Output added later, with no panel, meets no Phase-1 or Phase-2 blocker. The pipeline delete then cascades to it.
- **D1's doomed set matches what the delete really removes.**
  - `removalOf` (PipelineStepRepository.scala:1463-1468) removes the target and its tail subtrees. The head child and its subtree are promoted and survive.
  - `removedByDeleteInternal` (:1113) shares `removalOf` with the delete. "Removal set minus the step itself" therefore equals the tail descendants the delete takes.
  - The panel arm already filters Outputs by `node.stepId` over the same set.
- **D2's journaling mechanism is buildable and leaves the wire unchanged.**
  - `applyResolved` (PatchSetApplyService.scala:128-170) already threads a separate `rawConfigs: Map[Int, JsValue]` accumulator, keyed by `edit.index`, next to the unchanged `applied` tuple. `journalSuccess` (:216-241) reads it. A sibling `createdChildren` accumulator fits the same shape. `EditOutcome` and the `/apply` response stay untouched. Round 2's CR1 is resolved.
  - `JournaledEdit` (PatchSetApplicationRepository.scala:119-137) is `jsonFormat8` with a defaulted `Option` (`inlineSources`). A ninth defaulted `Option` field reads old rows as `None`.
  - No test constructs `JournaledEdit(` directly (grep over `backend/src/test`: 0 hits). The default parameter therefore breaks no call site.
- **The `createdChildren` listing is exact.**
  - `PipelineCreateWrites.create` writes the pipeline, its steps and its Outputs in one transaction (:30-50 doc).
  - Inline root sources are separate committed writes, but they are neither steps nor Outputs.
  - A pipeline created a moment ago has no grants. Nobody else can write to it between `applyOne` returning and the internal read.
- **The legacy fallback rests on true clock facts.**
  - `OutputRepository.insertInternalAction` uses `Instant.now()`, as does `PipelineStepRepository.insertInternalAction`.
  - The draft-save writes (`PipelineDraftWrites.scala:155,219`) also use `Instant.now()`.
  - `appliedAt` is `Instant.now()`, taken after every edit (PatchSetApplyService.scala:231).
  - No DB `now()` is involved, so the residual is only clock skew between instances, as stated.
- **Excusal by id survives normal editing.** The draft save keeps surviving step and Output ids (`DraftDiff`/`DraftPlan`: "the server never deletes a step the draft keeps"; relinks and content updates are updates in place). Editing a set-created pipeline therefore does not turn its own steps into blockers.
- **D2 point 1 is correctly marked unreachable through apply.**
  - `resolvePipelineStepCreate` (PatchSetPipelineStepResolvers.scala:140-160) runs `checkAdd` against a stored pipeline.
  - `PatchSetRefs` substitutes only Output refs into panel creates (PatchSetApplyService.scala:150-153).
  - The spec scenario no longer has the untestable parenthetical. Round 2's CR2 is resolved.
- **Editor write paths exist.** `OutputService.create` requires Editor or Owner (OutputService.scala:123). `PipelineStepWriteChecks` has `requireEditorAccess` for an editor grant (:40, :186). An existing HEL-1720 spec already has an editor grantee create an Output on A's pipeline through `appOutputs.create` (PatchSetUndoBoundOutputPanelsSpec.scala:267-277). The red test in D5 is therefore buildable on the app role.
- **AC trace.**
  - AC1, a red test on `helio_app_test` with a two-user setup: D5 and task 1.2, with a `rolbypassrls = false` assertion and the red run committed first.
  - AC2, 409 with nothing changed and HEL-1720 naming: spec scenarios 1-3 and D3. Readable Outputs are named, the rest counted, no ids, and `NameCap` is reused through a generalised `describeBlocking` formatter.
  - AC3, same-user later additions blocked and only set-created rows excused: D2 (the exact journal rule, and the legacy rule requires `created_at <= appliedAt`), plus spec scenario 2.
  - The ticket's "check steps" item is taken up with the same rule.
  - The surface re-check (route, helio-mcp description, web toast) is task 3.3. I confirmed `helio-mcp/src/tools/refinement.ts:131` carries the "whole undo is refused" wording.
- **Scope.** There is no `dataSource` create work (HEL-1796) and no service split (HEL-1797). The `PatchSetUndoService` change is limited to `ifStillUnbound`. There is no migration and no schema change.
- **No contradiction with the existing capability spec.** `openspec/specs/patch-set-undo/spec.md` has no requirement that a create undo must delete Outputs added later. ADDED, rather than MODIFIED, is therefore correct.
- **No placeholders, and no unsettled product question.**
  - The alert-rule cascade is explicitly out of scope and will be filed as a follow-up. That is consistent with the ticket's ACs, which name Outputs and steps only.
  - Later-added schedules and roots are noted for the PR.

### Verdict: CONFIRM

### Non-blocking notes

- **An existing assertion flips, and the tasks should name it.** `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoLaneSpec.scala:86-133` (HEL-914 task 5.6, tightened by HEL-1720) inserts a same-user Output on a set-created step after the apply (`outputRepo.insertInternal`, :99). Once the panel is gone it asserts that the undo succeeds and the Output is deleted (:121-133). Under this change that Output is a later addition and must block, so the test's second half fails by design. The executor should:
  - change it deliberately: remove the Output too, then assert that the undo succeeds;
  - record in files-modified/evaluation that the old behaviour was intentionally reversed, not "fixed to pass";
  - audit any other spec that adds an Output or step to a set-created pipeline or step and then expects the undo to succeed.
- **Misleading wording in a rare edge case.** A splice-inserted step (`position` set) re-parents one existing step under itself. That step is normally the promoted head child, so it is not doomed. If a later child sorts ahead of it on `(position, id)`, the pre-existing step becomes a tail. The new rule would then refuse, which is the safe direction, but with the "added after the patch set was applied" wording. Today the undo silently deletes it. A message tweak is not required. It may be worth a comment, or a line in the PR.
- **Declaration order of the new format.** `PatchSetApplicationRepository.scala:134` has a comment that a format declared after `journaledEditFormat` reads as null at runtime. The new nested `createdChildren` format must be declared before it. The old-row parse test in task 2.1 should also round-trip a row that has the field.
- **Alert rules.** The draft-save undo requirement in the main spec (lines ~206-257) already blocks on alert rules that target a created Output. The follow-up ticket for patch-set undo alert rules can cite that precedent.
