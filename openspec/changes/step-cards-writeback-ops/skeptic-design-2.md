## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Fresh cold spawn. Reviewed at `HEAD` = `b590855d5f2ddc76c9abf2e75fca5e5120cd5d7a`.
Every finding below is re-derived from source in this worktree; round 1's report and the
orchestrator's CR-by-CR summary were read as claims only.

**Cwd guard.** `assert-cwd.sh /home/matt/Development/helio <WORKTREE_PATH> <BRANCH>` →
`READY ambient=/home/matt/Development/helio branch=feature/step-cards-three-new-steps/hel-1109`.

### What I verified (with evidence)

**CR1 — convertformat seed. MET, and the mechanism re-derived independently.**
`ConvertFormatConfig.pairError` (`backend/src/main/scala/com/helio/domain/steps/ConvertFormatConfig.scala:48-62`)
extracts via `obj.fields.get("from").collect { case JsString(s) => s }`, so `""` yields
`Some("")`; `("","")` is not in `ConvertFormatStep.SupportedPairs` (`ConvertFormatStep.scala:45`),
so the `(Some(f), Some(t))` arm fires → `Some(error)` → `UnprocessableEntity`. Absent keys hit
`case _ => None`. The backend tests pin only the absent cases
(`ConvertFormatStepSpec.scala:458-462`: `{"field":"c","from":"csv"}`, `{"field":"c"}`, `{}`) and
never `("","")` — so the blind spot was real. design.md D3 now states the literal seed
`{ field: "" }` with `from`/`to` **deliberately ABSENT**, cites the `upsertsource`
`{ mode: "append" }` precedent (confirmed verbatim at `stepNarrowing.ts:250-254`, with its own
"`target` deliberately ABSENT" comment), and tasks.md 1.4 requires asserting the **absence** of
both keys. proposal.md's justification now says "tolerates those keys being absent yet rejects a
present-and-empty pair with a 422". Correct on all three surfaces.

**CR2 — status codes. MET in every binding artifact, and NOT over-corrected.**
`PipelineService.addStep` (`:1787-1800`) returns `ServiceError.BadRequest` for
`!PipelineStepKind.All.contains(req.type)` and again for a decode `Failure`, and
`ServiceError.UnprocessableEntity(rawConfigError.get)` for a `validateRawConfig` rejection.
design.md Context:11-14 states exactly that split (422 for config rejection, 400 reserved for
unknown type and decode failure) — so the correction is accurate *and* the 400 cases that are
genuinely 400 are preserved. A repo-wide grep for `400` across the change dir returns only:
design.md:12 (the correct contrast sentence), tasks.md:3 / workflow-state.md:31 (C1's own text),
and ticket.md:22 (see non-blocking note 1). All three spec deltas now say "a named 422"
(`pipeline-convertformat-editor` req 1, `pipeline-analyzewithai-editor` "Only model-producible
types", `pipeline-generatetext-editor` "All three fields are required"). No 400 claim survives on
a config-rejection path.

**CR3 — 50-cap and completeness predicate. MET.**
`AnalyzeWithAiConfig.MaxOutputSchemaEntries: Int = 50` at `AnalyzeWithAiConfig.scala:30`;
`validate` (`:61-`) enforces, in order: non-empty `inputField`, non-empty `instruction`,
non-empty `outputSchema`, `length > Max`, non-empty entry names, unique names, no name equal to
`inputField`, types within `AllowedOutputTypes = {string, integer, float, boolean}` (`:29`).
`GenerateTextConfig.validate` requires all three fields non-empty (trim-based). design.md D3's
completeness bullet mirrors that list field-for-field, including "1..50"; the analyzewithai spec
gained "The declared schema is capped at the backend's supported entry count" + a 51st-field
scenario; tasks 2.3 and 3.3 both carry it, with 3.3 requiring a rejection-arm test table so the
predicate can be neither narrower nor wider. Nothing left expressible that the UI knew was bad.

**CR4 — persist premise. MET, and the underlying defect re-confirmed.**
`useStepCardState.persist` early-returns **only** on `isUnsupportedOpType(step.opType)`
(`useStepCardState.ts:238`); there is no temp-id check and `updatePipelineStep` is called
unconditionally. The only temp-id guards in the tree are the ad-hoc
`startsWith("step-")` checks in `usePipelineDetailPage.ts:952`, `:1055`, `:1068`. The
`handleInsertStep` comment "PATCH calls will be no-ops until ID is real" is at
`usePipelineDetailPage.ts:688` and is indeed false. design.md D3 states all of this plainly,
including that the earlier draft's claim was wrong, and chooses option (a) with the stated
rationale (fixes the latent defect for all 27 ops rather than only two) → task 3.1, whose
verification requires both halves (no PATCH for a temp id AND a real id still PATCHes). The
risk section correctly flags that the guard must be proven not to suppress a legitimate PATCH.

**CR5 — task 4.1 guard. MET, and I checked it is satisfiable rather than red on arrival.**
`PipelineStep.Registry` (`PipelineStep.scala:225-252`) holds 27 kinds including `join`,
`upsertsource`, `convertformat`, `analyzewithai`, `generatetext`; `PipelineStepKind.All =
PipelineStep.Registry.keySet` (`:302`). `OP_TYPES` (`stepNarrowing.ts:102-130`) has 23 entries
ending at `upsertsource`, with `join` deliberately held in `JOIN_OP_TYPE` outside the picker and
resolved separately at `:282-285`. So after this change registry(27) = OP_TYPES(26) ∪ {join} —
the guard passes on arrival with the single `join` exception 4.1 names, and no second exception
is owed (`upsertsource` is registered; the "deliberately NOT registered" comment at
`UpsertSourceConfig.scala:17` is stale prose, not the live Registry). The precedent test
`frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts` exists. 4.1 now
requires proving failability in the purpose's direction (add a fake kind to the *parsed source*
and show red) per [C2], which is the mutation that a hardcoded twin could not survive.

**CR6 — vocabulary. MET.** design.md D6 rules explicitly *against* `FormField`, names the
DESIGN.md §6 tension, states the 22-sibling divergence as the reason, and records the trade-off
so the executor does not invent a third option. tasks.md 2.6 repeats the prohibition inline.

**CR7 — draft affordance. MET, and the primitive actually supports the treatment.**
`frontend/src/shared/ui/StatusChip.tsx` declares `intent` (including `"neutral"`) and
`dashed?: boolean` ("Dashed-border, transparent-background treatment for 'no data yet' states"),
and `PipelineListTable.tsx:37-39` already uses `<StatusChip intent="neutral" dashed>Never run`.
D6 and task 3.7 name exactly that, and exclude `SaveStateIndicator`.

**CR8 — estimatedRows. MET.** `CostVerdict` is typed at `pipelineStep.ts:532` with
`estimatedRows?: number` (`:534`) and is pipeline-level. D5 and the
`pipeline-ai-step-authoring` requirement + its dedicated scenario both attribute the number to
the PIPELINE and forbid presenting it as this step's call count, with the row-reducing-step
reason given. Task 3.8 verifies presence on AI cards, absence on `convertformat`, and that no
currency/token figure renders.

**Non-blocking notes from round 1 — both applied.** The legacy unsupported `from`/`to` pair is
now a design.md D2 clause, a `pipeline-convertformat-editor` requirement ("preserved, not
silently coerced") with a scenario, and tasks.md 2.2 — against the real
`SortConfig.tsx:66-76` "preserve the current value as an option" precedent, which I read.
tasks.md 1.1/1.2/1.3 are now real evidence: 1.1 requires a compile-time assignability assertion
(correct, since `PipelineStepKind = PipelineStep["type"]` is derived, `pipelineStep.ts:351`),
1.2 a type-level narrowing test, and 1.3 explicitly forbids citing the circular
`toHaveLength(OP_TYPES.length)` assertion.

**Self-corrections the orchestrator disclosed — both check out.** Zero occurrences of
`stretchNarrowing` anywhere in the change dir; every citation reads `stepNarrowing.ts`.
design.md is exactly 150 lines (`wc -l`), within the artifact limit, and the trim did not drop
any CR-mandated content — all eight fixes are present and legible.

**Constraints recorded.** workflow-state.md:31 carries C1 and C2 verbatim with
`agreed_at: design-gate`, and tasks.md:1-4 mirrors both under "## Standing Constraints".

**Artifact gates re-run fresh.** `npm run check:spec-structure` → `spec-structure check passed
(391 canonical specs, 0 issues)`; `openspec validate step-cards-writeback-ops --strict` →
`Change 'step-cards-writeback-ops' is valid`.

**Scope and coverage.** The three ACs trace to tasks: UI-authorable → 1.3/2.1/2.3/2.5/2.7;
agent-authorable → already true, verified by 4.3 and the three round-trip requirements;
identical configs → 4.3 including `outputSchema` element order. No task exceeds the ticket's
scope; the HEL-1136 boundary (no group field, no `OpDropdown` restructuring) is honored in D1,
Non-Goals and 1.3. No placeholder, `TODO` or deferred decision remains in any artifact.

**Surviving round-1 requests: none.** All eight are met as described above, on the artifacts the
executor and evaluator will actually read.

### Verdict: CONFIRM

The plan is implementable as written. The two premises that were wrong in detail (CR1, CR4) are
now correct *and* stated as the load-bearing facts they are; the guard test (CR5) is both
failable in its purpose's direction and satisfiable on arrival; the status codes match the
`ServiceError`s the code returns without over-correcting the two genuine 400 paths; and the two
UI-vocabulary rulings (CR6, CR7) name primitives that exist with the props they claim. Nothing
the revisions introduced is a defect.

### Non-blocking notes

1. `ticket.md:22` still reads "anything else (including `from == to`) is a named **400**". That
   path is `pairError` → `UnprocessableEntity` (422), so the sentence is false in exactly the way
   C1 exists to prevent. It sits under "Verified ground truth", which an executor reads as fact.
   C1's literal wording covers "a spec, design or report" and this is the ticket transcription,
   and every binding artifact is correct — so this is not blocking, but it is a one-word fix and
   worth taking so the change dir does not contradict its own constraint.
2. Three citations drifted by a line or two and are worth correcting in passing, not re-reviewing:
   design.md D3 says the 50-cap is "enforced `:68-69`" (actually `AnalyzeWithAiConfig.scala:66-67`;
   the `MaxOutputSchemaEntries = 50` citation at `:30` is exact), and `handleInsertStep:685`'s
   inaccurate comment is at `usePipelineDetailPage.ts:688`. D2's `SortConfig.tsx:68-76` is
   effectively `:66-76`.
3. `UpsertSourceConfig.scala:17-19`'s "Deliberately NOT registered in `PipelineStep.Registry` /
   `PipelineStepKind.All` yet" is stale — the kind is registered at `PipelineStep.scala:248`.
   Out of scope here, but if task 4.1's guard parses that file's prose rather than the `Registry`
   map, the stale comment is a trap; parse the `Registry` map only.
4. Evidence-path note carried from round 1 still holds and is now disclosed in design.md's
   Planner Notes: `premise-validation.md` lives in the MAIN repo under
   `/home/matt/Development/helio/.concertino/runs/HEL-1109/evidence/`, not under `WORKTREE_PATH`.
5. No claim in this report rests on mtime ordering or directory position; every finding is a
   content citation (file:line or pasted command output). No report I drilled into disclosed
   unsound evidence mtimes, so no mtime-acceptance gate defect arises.
