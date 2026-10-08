## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 2dd4ed6237817b1feef22d69f8bc8058e58541db. The planning artifacts are untracked under the change dir. All
paths below are under `backend/src/main/scala/com/helio/`.

### What I verified (with evidence)

**CR1 (patch-set pipeline-create 422) is addressed in substance, and the 422 path is real.**
- `resolveAll` (services/patchsets/PatchSetApplyResolvers.scala:33-47) short-circuits on the first `Left`.
  `PatchSetApplyService.apply` (L75-79) returns that `Left` before `applyResolved` runs, so no edit is applied.
  `PatchSetRoutes` (api/routes/patchsets/PatchSetRoutes.scala:39-55) goes through `ServiceResponse.run`, which maps
  `ServiceError.UnprocessableEntity` to `StatusCodes.UnprocessableEntity` (api/routes/ServiceResponse.scala:102). A
  resolve-time `Left(UnprocessableEntity)` therefore really is HTTP 422. The spec scenario, task 2.3, decision 4, task 3.1a,
  and proposal "What Changes", table and Impact now all agree.
- `resolvePipelineCreate` (L538-578) currently only pre-checks roots, so the planned insertion point exists. Its result is
  built from the decoded `CreatePipelineRequest`, which has the steps the loop needs.
- **The preview path also runs it.** `PatchSetPreviewService.preview` (PatchSetPreviewService.scala:43-47) calls the same
  `resolveAll`, so `/api/patch-sets/preview` will also return 422 for such an edit. Its consumers are
  `RefinementService.parseAndValidate` (RefinementService.scala:122-129) and the assistant's `propose_patch_set`
  (AssistantToolExecutor.scala:324-330). Both turn a preview `Left` into an error message that goes back to the model.
  That is an improvement: the model gets the "unknown function" message to repair, instead of a proposal that fails at
  apply. It also matches the existing step-update resolve check, whose own comment at L189-191 names preview and
  refinement as intended beneficiaries. This is acceptable, but no artifact mentions it (see note 1).

**CR2 (write-path table) is partly addressed.**
- Correctly fixed in proposal.md: undo and rollback are reclassified as validated
  (PatchSetUndoService.scala:231,265,270 and PatchSetApplyRollback.scala:158,209,216 call `addStep`/`updateStep`, which
  validate at PipelineService.scala:1819-1831 and 2185). First-run and persona go through proposal apply: the
  `FirstRunDashboardService.scala:141` path → `PipelineProposalService.apply` → `validateStructure` → `validateSteps`
  (PipelineProposalService.scala:285-297, 422). Shape expansion goes through `addStep`. `duplicateStep` is the only
  unvalidated re-write. The proposal Non-goals, decision 5 (now a pin), decision 6 (`add_outputs_from_shape` →
  `addPipelineStep`), and task 2.4 (labelled a regression pin) are all corrected.
- **Not fixed in design.md.** design.md:29 (Non-Goals) still says "validating duplicate/undo/rollback replays", and
  design.md:80 (Planner Notes) still says "Self-approved: duplicate/undo/rollback replays stay unvalidated (they replay
  stored state)". That is the false claim CR2 asked to remove. It now contradicts proposal.md:44 ("Undo and rollback
  already validate via addStep/updateStep").
- **A new factual error of the same kind CR1 caught.** proposal.md:14, proposal.md:28, design.md:22, design.md:51 and
  spec.md:12 all claim that patch-set *step* edits (create and update) already reject at resolve time with 422. Only
  **update** does: `validateEmbeddedStepReferences` (PatchSetApplyResolvers.scala:178-226, check at L204-207).
  `resolvePipelineStepCreate` (L709-730) never calls `validateRawConfig`. Its only config work is
  `authorizeSecondSourceForCreate` (L738-757), which explicitly lets a decode failure through to forward-apply. An invalid
  patch-set step **create** is therefore rejected by `addStep` at forward-apply, and the response is **HTTP 200 with
  `failure` set** (PatchSetApplyService.scala:126-129), not a 422. The table row "Patch-set step create / update ...
  (422)" and decision 4's rationale ("consistent with its own step edits (resolve-time 422 ...)") are wrong for create.
  The change does not need to fix step create, because the AC lists single-call create, step routes and proposal apply.
  But the artifacts must not state it as fact. An evaluator could otherwise "verify" consistency against a property
  that doesn't exist, which is the exact failure CR1 named.

**Other checks.**
- The 422/400 split and message plumbing: `addStepReporting` (L1825-1838) checks type, then `validateRawConfig`, then
  decode. Decision 1's ordering mirrors it. `validateSteps` uses a `step N:` prefix, and the step-update resolver uses
  `edit N:`. The planned `Step '<clientId>':` and `edit N: Step '<clientId>':` prefixes don't collide with either.
- Callers of `create`: `CreatePipelineRequest(` has only the protocol reader (PipelineProtocol.scala:334) and
  `PipelineProposalService.scala:458` outside the route. `pipelineService.create` has only `PatchSetApplyForward.scala:87`
  in services. Undo and rollback never recreate a pipeline (`PatchSetApplyRollback.scala:151-152` marks a pipeline
  delete as not recreatable). The table has no missing caller.
- No placeholders or TBDs. The tasks have concrete acceptance signals, and red-first applies to the two newly validated
  paths (2.1-2.3) with a mutation check (3.2).

### Verdict: REFUTE

### Change Requests

1. **Finish CR2 in design.md.** Remove "undo/rollback" from the design.md:29 Non-Goals and from the design.md:80 Planner
   Note. Only `duplicateStep` stays unvalidated. Say that undo and rollback already validate via `addStep`/`updateStep`,
   so design matches proposal.md:44.
2. **Correct the "patch-set step edits reject at resolve time with 422" claim at every site:** proposal.md:14,
   proposal.md:28 (table row), design.md:22, design.md:51 and specs/pipeline-step-config-rejection/spec.md:12. Ground
   truth: patch-set step **update** rejects at resolve time with 422 (PatchSetApplyResolvers.scala:204-207). Patch-set
   step **create** is validated only at forward-apply by `addStep`, which gives HTTP 200 with `failure` set and earlier
   edits rolled back (resolvePipelineStepCreate L709-730 has no `validateRawConfig`). Re-word decision 4's rationale to
   "consistent with patch-set step *update*". Either leave step create as is and say so explicitly, or record it as a
   follow-up. Do not widen scope silently.

### Non-blocking notes

1. Say in decision 4, or in proposal "What Changes", that `resolvePipelineCreate` is shared with
   `/api/patch-sets/preview`, so preview, refinement and assistant `propose_patch_set` will also reject (422 or a
   tool-error message) a pipeline-create edit with an invalid step config. This is intended and matches step update. A
   one-line preview assertion in task 2.3 would pin it cheaply.
2. spec.md's "This SHALL apply equally when ... reached through a pipeline proposal apply" sits right after the sentence
   requiring the message to name the step "by its client id". On proposal apply, `validateSteps` rejects first with
   `step N: <msg>` (index, not client id), and decision 3 keeps that. Scope the proposal-apply sentence to "same 422
   status, atomic" so the final-gate reviewer doesn't read it as requiring a clientId-named message there.
3. Existing backend specs that build patch-set pipeline-create edits or single-call creates with loosely-shaped step
   configs may start failing. Treat any such failure as a fixture-vs-defect question (MISTAKES / "fixture change is a
   symptom"), not a reason to edit the fixture silently.
