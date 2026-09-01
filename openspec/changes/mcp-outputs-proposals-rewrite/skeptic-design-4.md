## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

**Round-3 item 1 — `list_outputs` route claim: FIXED, verified.**
Read `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` directly.
`nestedRoutes` (lines 30-49) is `pathPrefix("pipelines" / PipelineIdSegment / "outputs")` with
`parameter("nodeStepId".optional)` — the scoped arm. `listRoutes` (lines 100-118) is
`path("outputs")` with only `offset`/`limit` — no pipeline/node filter. The rewritten requirement
in `specs/mcp-output-tools/spec.md` now matches both arms exactly, including that the unscoped arm
returns a `PagedResult` envelope (verified: `complete(PagedResult(...))`, line 113) vs. the nested
arm's `OutputsResponse{items}`. Two scenarios cover both arms. Correct.

**Round-3 item 2 — jest evidence command in 3.1 / 5.6 / 5.9 / ticket AC: FIXED, consistent.**
Read all four. 3.1 and 5.6 now point at 5.9's command and explicitly forbid root `npm test` as
evidence; 5.9 carries the verified command and now says "all suites green, none skipped" with an
explicit note that the count may grow past 14; ticket AC matches. The underlying trap is real:
`jest.config.cjs:16` (`testPathIgnorePatterns`) and `:22` (`modulePathIgnorePatterns`) both exclude
`/.claude/worktrees/`. Internally consistent.

**`openspec validate mcp-outputs-proposals-rewrite --type change`** → `Change
'mcp-outputs-proposals-rewrite' is valid`.

**`asNumeric` protection (design Non-Goals + `workspace-context-assembly` spec): accurate.**
`WorkspaceContextService.scala:754-758` is a single `match` piped into one terminal
`.filter(_.isFinite)`; `:723` is `BigDecimal(v).setScale(MeanRoundingScale, RoundingMode.HALF_UP)`.
The design's description of what must not change matches the code byte-for-byte. Good.

**Design decision 5's `output.schema.json` citation: accurate.**
`schemas/outputs/output.schema.json` has `"nodeStepId": { "type": ["string", "null"] }`. The
source-attached-Output grounding path (task 1.4 + the matching spec scenario) is well-founded.

**HEL-766 (patch-set inverse builders): NOT actually addressed — see CR1.**
Read the Linear ticket and both files. HEL-766's named defect is in
`backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala`, lines 281-289:

```scala
  private def fullPipelineStepInverse(prior: PipelineStep): UpdatePipelineStepRequest =
    UpdatePipelineStepRequest(`type` = Some(prior.kind), config = ..., position = Some(prior.position))

  private def pipelineStepCreateRequestFromPrior(prior: PipelineStep): CreatePipelineStepRequest =
    CreatePipelineStepRequest(`type` = prior.kind, config = ...)
```

Both still drop `prior.enabled` — the defect is live on this branch. The sibling file
`PatchSetUndoInverse.scala:122-145` (the cross-call undo journal) was already fixed by HEL-705 and
does carry `enabled`.

**Outputs and placements have no `enabled` field at all.** Verified three ways:
`Output` (`backend/.../domain/model/model.scala:796-810`) has `id/name/ownerId/node/kind/
createdAt/updatedAt/schema` — no `enabled`. `OutputResponse`, `CreateOutputRequest`,
`UpdateOutputRequest` (`OutputProtocol.scala:16-46`) — no `enabled`.
`schemas/outputs/output.schema.json` is `additionalProperties: false` and does not list it. The
only `enabled` in `schemas/panels/**` is `panel-appearance.schema.json`'s `tooltip.enabled`
(line 49), unrelated. `enabled` in this domain is a **pipeline step** field.

**HEL-670 (refinement targeting): under-specified — see CR2.** Read the Linear ticket. Its AC2 is
unconditional ("Add a regression test … asserting a `create` edit's own target and any same-patch-set
follow-up edit's `target.id` are never fabricated/aliased onto an unrelated real resource"), and its
cancel-into-HEL-907 note says P1.4 "re-verifies refinement targeting against implied Outputs **and
adds the regression test**". The ticket's own Scope line also says "add regression test".

**Teardown cascade:** `WorkspaceTeardownRepository.scala:28-29,121` already states Outputs cascade
via the `outputs` table FK from their owning pipeline (HEL-904). See non-blocking note.

**Planner Notes:** both self-approvals are within scope and correctly bounded (the HEL-934 fold-in
is named in the user's delivery brief; the "no new backend routes, escalate on a genuine gap" note
is the right posture). No objection to either — but see CR1, which is a case the second note should
have caught: the design as written implies a model change (`enabled` on Outputs) that is neither
escalated nor scoped.

### Verdict: REFUTE

### Change Requests

1. **The HEL-766 absorption is aimed at the wrong entity and the wrong file, and its stated fix
   mechanism cannot work.** `design.md` decision 7, ticket AC ("Patch-set undo test covering
   add/remove/modify of an Output and a placement, `enabled` preserved"), and four spec deltas
   (`patch-set-apply`, `patch-set-undo`, `patch-set-contract` by implication, `mcp-patch-set-tools`)
   all require preserving `enabled` on **Outputs and placements** — entities that have no `enabled`
   field (evidence above). The scenario "Modify-patch on a disabled Output keeps it disabled after
   apply" is not implementable against the P1.1-P1.3 model without a new column + migration + wire
   change, which is explicitly out of this ticket's scope. Meanwhile the real HEL-766 defect
   (`PatchSetApplyRollback.scala:281-289`, pipeline **steps**, both the update-rollback and
   delete-compensation paths) is named nowhere in `design.md`, `tasks.md`, or any spec delta, so
   this change would ship claiming to absorb HEL-766 while leaving it live.
   Required revisions:
   - Re-target decision 7 and the four spec deltas at **pipeline steps/nodes** (`PipelineStep.enabled`),
     naming `PatchSetApplyRollback.scala`'s `fullPipelineStepInverse(prior: PipelineStep)` and
     `pipelineStepCreateRequestFromPrior(prior: PipelineStep)` as the two builders to fix, and
     `PatchSetUndoInverse.scala` as already-fixed (HEL-705) but to be preserved through the rewrite.
   - Drop or restate the Output/placement `enabled` scenarios. If you believe Outputs genuinely
     need an `enabled` concept in the new model, that is a model change requiring a migration —
     escalate it, do not smuggle it in via a patch-set spec scenario.
   - Correct decision 7's mechanism claim. "Thread the field through the builder's own input/output
     types so a missing value is a compile error" is false for these types:
     `CreatePipelineStepRequest.enabled: Option[Boolean] = None` and
     `UpdatePipelineStepRequest.enabled: Option[Boolean] = None`
     (`PipelineStepProtocol.scala:160-171`) both have defaults, so omitting the argument compiles
     silently — which is precisely how the current gap survived. State a mechanism that actually
     holds (e.g. removing the default on the builder-facing constructor, or an exhaustive
     round-trip test per path), not a compile-error claim that the code contradicts.
   - Add the two test paths HEL-766's own ACs require (mid-apply rollback of a disabled step's
     update; delete-compensation recreate of a disabled step) as explicit tasks under §5. Task 5.5
     as written covers only the undo journal path.

2. **HEL-670's regression test is mandated unconditionally but has no task, and "fix if
   reproducible" is an unworkable gate.** `tasks.md` 1.6 reads "Re-verify HEL-670 … fix if
   reproducible" — but HEL-670 manifested in 1 of 3 live Claude trials (stochastic), so
   "reproducible" is not a condition an executor can discharge honestly; it is an invitation to
   record "not reproduced" and move on. HEL-670's AC2 and this ticket's own Scope line both require
   the regression test unconditionally, and HEL-670's AC1 requires the `RefinementEditShape`
   create-path guidance fix itself. Required revisions:
   - Rewrite 1.6 to name `RefinementEditShape`'s create-context guidance as the artifact to update
     for the Outputs model (implied-Output create + follow-up edit), unconditionally — not gated on
     reproducing a stochastic LLM behavior.
   - Add a §5 task for the regression test HEL-670 AC2 names (a `RefinementEditShapeSpec` /
     `RefinementServiceSpec`-level test with a scripted multi-edit response asserting a create
     edit's target and any same-patch-set follow-up `target.id` are never aliased onto an unrelated
     real resource), and add a matching scenario to a spec delta so the requirement is captured, not
     just the task.

3. **No spec delta captures the HEL-766/HEL-670 requirements at the level they will actually be
   verified.** Both are listed in `proposal.md` as "absorbed", and the final gate is a
   dimension-split fan-out where one skeptic owns "proposal/patch-set contract both-sides
   consistency". As written, that skeptic has no requirement text to check the step-`enabled`
   round-trip or the refinement-targeting guard against. Add the requirements produced by CR1 and
   CR2 to `specs/patch-set-apply/spec.md` (or a new `patch-set-rollback` delta) and to a refinement
   capability delta respectively.

### Non-blocking notes

- `tasks.md` 2.1 says "**Extend** `teardown_resources`-backing tag-cascade so deleting a tagged
  pipeline removes its Outputs and their placements", but `WorkspaceTeardownRepository.scala:28-29`
  and `:121` already document Outputs cascading via the `outputs` table FK (HEL-904/P1.1), and the
  ticket AC itself says "backend branch rewired in P1.1; **tool + test here**". Reword 2.1 to
  "confirm and test the existing cascade; do not modify the backend cascade unless a verified gap
  is found" so the executor doesn't re-do P1.1's work.
- Design decision 5 cites `output.schema.json` without a path; it is `schemas/outputs/`, not
  `schemas/pipelines/`. The claim itself is correct — just add the path so a later reader can
  verify it in one step.
- `specs/mcp-output-tools/spec.md`'s `list_outputs` requirement is now correct; worth also stating
  that the two arms return **different envelopes** (`OutputsResponse{items}` scoped vs.
  `PagedResult` unscoped), so the tool's own return contract doesn't silently vary in a way the
  agent can't predict. Currently only the unscoped arm's envelope is named.
