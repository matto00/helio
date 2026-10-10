## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: c804b4296fe7b9a355dc0e00e51ca404dea0800e. The worktree is clean apart from the untracked change dir.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/step-config-validation-followups/HEL-1417`.
- **Ticket source.** I read the Linear issue HEL-1417. It has only items 1–5 and no ACs, so AC1–AC5 in ticket.md were written by the orchestrator. They match the items. Item 3 does not say which fix to make, so AC3 choosing the analyze-side fix stays within scope.
- **Item 1 / D1 premise.** In `PatchSetApplyResolvers.scala:718-740`, `resolvePipelineStepCreate` runs these checks only: parentId, then `authorizeEditorOrOwnerOnPipeline`, then `decodeCreatePatch`, then `authorizeSecondSourceForCreate`. It does not run `validateRawConfig`.
  - Preview does not reject it either. `PatchSetPreviewProjection.scala:111-116` just echoes `pipelineStepCreateAfter(request)`, so today's preview returns 200. The "preview 200 before the fix" red-first claim holds.
  - Apply and preview both go through `resolveAll` (`PatchSetApplyService.scala:76`, `PatchSetPreviewService.scala:44`). `resolveAll` short-circuits on the first `Left`, before anything is applied. So a resolve-time `Left(UnprocessableEntity)` gives "422, no edit applied, no step created" on both routes.
  - Edits are 0-indexed (`edits.zipWithIndex`, l.47), so the spec scenario's "second edit → `edit 1: `" is correct.
- **D1 message shape.** The update edit returns `UnprocessableEntity(s"edit $index: $msg")` (l.205-207). The pipeline-create edit returns `edit $index: Step '${clientId}': $msg` (l.576-580). REST `addStepReporting` returns the bare `msg` (`PipelineService.scala:1856-1864`).
  - `CreatePipelineStepRequest` has no clientId, so `edit N: <msg>` is the right analogue. AC1 states it and the spec delta matches it.
  - For an unknown type, `companionFor` returns `Left`, the helper gives `None`, and the edit falls through to the unchanged apply-time path. The design states this explicitly.
- **Item 2 / D2: the six sites.** `git grep validateRawConfig` over `backend/src/main` found exactly six call sites, at the lines the design gives: PatchSetApplyResolvers 205 and 578, PipelineProposalService 296, PipelineService 561, 1857 and 2211. The seventh variant is at StepConfigValidation.scala:49 and reuses one `companion` lookup.
  - `companionFor` returns `Either[String, Companion]` (`PipelineStep.scala:278`), so the proposed `rawConfigProblem(kind, raw): Option[String]` is type-correct.
  - All six sites wrap the result differently (bare, `edit N:`, `Step 'id':`, `step N:`), which backs the "lookup-only helper" choice. Leaving l.49 alone is consistent with AC2, which counts exactly 6.
- **Item 3 / D3.** `ColumnSchemaInference.scala:48-75` reads `json.fields("type")`. That throws `NoSuchElementException` when the key is absent, and the catch-all turns it into `"compute config error"`, so the premise holds. `ComputeConfig.type` is `Option[String]` (`ComputeStep.scala:14,23`).
  - No existing test asserts "compute config error". The only grep hits are the source and archived changes, so D3 will not break an existing expectation.
  - The analyze-side choice avoids breaking writes and matches the documented-optional contract. I did not re-run the dev-DB count; the decision does not depend on it.
- **Item 4.** `PipelineCreateStepConfigRoutesSpec.scala:145` asserts only `include("agg")`. The main spec's Purpose (l.4) covers only configs the system "cannot represent". Its requirements at l.97 (unparseable compute), l.141 (single-call create) and l.198 (enum values) are wider than that.
- **Item 5 / D5.** HEL-1463 exists in Backlog, links back to HEL-1417, and states a byte-move/javap/testFull proof standard. `PipelineService.scala` has 2651 lines. Deferring it is within the ticket's own "at the implementer's call" allowance, and the reason given (a behaviour-changing diff makes a byte-move proof meaningless) holds up.
- **Placeholders, contradictions, scope.** I found no TODO/TBD.
  - Every AC maps to tasks: AC1→1.3/3.1, AC2→1.1/1.2/3.2, AC3→1.4/3.3, AC4→1.5/3.4, AC5→D5.
  - Each task has a verification signal.
  - The proposal, design and tasks agree. Nothing goes beyond the ticket items.
  - No API schema shape changes beyond a status code on a path that already returns 422 for update edits.

### Verdict: CONFIRM

### Non-blocking notes
- The HEL-1416 requirement in `openspec/specs/pipeline-step-config-rejection/spec.md:198-202` lists which surfaces it covers: "patch-set step-update and pipeline-create edits". Once D1 lands, patch-set step-create edits also enforce those enum checks, through the same `validateRawConfig`. Consider widening that list along with the D4 Purpose edit, so the spec does not under-describe the behaviour. The same applies to the l.97 compute requirement's "patch-set apply" wording, which is already accurate.
- D3: if `"type": null` is present, `json.fields.get("type").map(_.convertTo[String])` still throws and falls into the generic branch. The design says a non-string type stays generic, so this is consistent. Use `StepCodecUtil.strOpt`-style handling if null should count as absent; this is the executor's call.
- tasks.md 1.1 says `sbt -J-Xmx3g compile`. The run's binding constraint is `nice -n 19 sbt -J-Xmx3g`, so use that form for every sbt invocation, compile included.
- D1 duplicate check: `addStep` will check the config again at forward-apply. That is harmless, and it is the same pattern the pipeline-create edit already uses.
