## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 2dd4ed6237817b1feef22d69f8bc8058e58541db. The planning artifacts are untracked under the change dir.
Unless a path says otherwise, it is under `backend/src/main/scala/com/helio/`.

### What I verified (with evidence)

**Round-2 CR1 (undo/rollback in design.md) is addressed.** A grep for `undo|rollback` across proposal, design, tasks and
spec gives four hits:
- design.md:30 (Non-Goals) says "validating `duplicateStep` ... undo/rollback already validate via `addStep`/`updateStep`".
- design.md:86 (Planner Notes) says "`duplicateStep` stays unvalidated ... Undo/rollback already validate (unchanged)".
- proposal.md:29 is the table row.
- proposal.md:44-45 is the Non-goals entry.

All four agree. Only `duplicateStep` remains unvalidated.

**Round-2 CR2 (patch-set step create vs update) is addressed at every site.**
- proposal.md:14 now says "like patch-set step update edits".
- The table splits "Patch-set step update | resolve-time (422)" from "Patch-set step create, undo, rollback | forward
  apply (200 + `failure`) | at apply time — unchanged".
- The design Context ends with "patch-set step **update** edits already reject at resolve time with 422 ... step
  **create** edits (`resolvePipelineStepCreate`) do not".
- Decision 4 now says "consistent with its step **update** edits".
- The Non-Goals and the Planner Note leave step create unchanged and name it as a follow-up candidate.
- spec.md:12 no longer claims anything about step edits.

These claims match the code:
- `resolvePipelineStepCreate` (services/patchsets/PatchSetApplyResolvers.scala:709-730) only decodes and authorizes the
  second source. It never calls `validateRawConfig`.
- The step-update check is at L205.

**Non-blocking notes from round 2 were applied.**
- Decision 4 states the preview/refinement/`propose_patch_set` consequence, and task 2.3 asserts that
  `/api/patch-sets/preview` returns 422.
- spec.md:11 scopes proposal apply to "fail with 422 and persist nothing".
- C6 records the fixture-edit discipline.

**I re-checked the code claims the plan rests on:**
- `buildStepsAction` (services/pipelines/PipelineService.scala:524-594) checks duplicate clientId, then type, then
  parentStepId, then decode. It never calls `validateRawConfig`, so the defect is real. The existing messages use the
  `Step '<clientId>'` prefix (L554, L588), which supports decision 2.
- `validateRawConfig` is already called at PipelineService.scala:1831 (addStep) and 2185 (updateStep),
  PipelineProposalService.scala:296, and PatchSetApplyResolvers.scala:205. That matches the "every other surface" claim.
- `resolvePipelineCreate` (PatchSetApplyResolvers.scala:538-578) only pre-checks roots. It decodes a
  `CreatePipelineRequest` whose `steps: Vector[CreatePipelineTransactionalStepRequest]` carry `type` and
  `config: JsObject` (api/protocols/pipelines/PipelineProtocol.scala:31-38, 78-84). Task 3.1a's insertion point and
  inputs therefore exist.
- `ComputeStep.validateRawConfig` (domain/steps/ComputeStep.scala:99-104) returns `None` for an empty or whitespace
  expression. The "empty compute draft still accepted" scenario and task 4.3 are therefore achievable.
- The "see premise-validation.md" reference in design.md:44 resolves to
  `/home/matt/Development/helio/.concertino/runs/HEL-1402/evidence/premise-validation.md`, which exists.

**No new inconsistency was introduced.**
- Proposal, design, tasks and spec agree on 422, the message prefixes, atomicity, the scope of the two newly validated
  paths, and red-first for exactly those paths. Task 2.4 is a labelled regression pin.
- I found no TBD, TODO or deferred decision.
- AC coverage:
  - single-call create: tasks 2.1 and 2.2.
  - step routes: already validated (HEL-860) and listed in the table.
  - proposal apply: task 2.4.
  - legacy read/analyze: task 4.4.
  - 422 instead of the ticket's literal 400: self-approved with stated rationale (consistency with every existing
    surface).

### Verdict: CONFIRM

### Non-blocking notes

- Proposal table row "Patch-set step create, undo, rollback ... (200 + `failure`)": the undo path reports failures
  through its own walk-stop result (`restoreFailed`, services/patchsets/PatchSetUndoService.scala:152+). It does not use
  the apply route's `failure` field. The "validated at apply time" substance is correct; only the response-shape label
  is loose for undo.
- Task 2.3's red-on-base parenthetical "(200 with `failure` set, or success)": on base, the forward `create` does not
  validate step configs, so the expected red is a plain success (pipeline created). The executor should record what
  base actually returns rather than assume the failure branch.
