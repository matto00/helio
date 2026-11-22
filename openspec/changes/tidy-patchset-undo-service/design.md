## Context

See proposal.md (Why). Current state at 4f57c5001:

- `PatchSetUndoService.scala` (426 lines): `undo` (dispatch + Phase 1), `restoreAll` (reverse walk, the only `log`
  call), `restoreOne` (per-kind dispatch), the guard wrappers `ifStillUnbound` / `ifNoLaterDatasetWork`,
  `restoreCreateUndo`, `restorePipelineCreateUndo`/`deletePipelineAndInlineSources`, the update restorers
  (panel/dashboard/dataSource/pipeline/pipelineStep), the delete restorers (`restorePanelDelete`,
  `restorePipelineStepDelete` + `restoreBoundOutputs`), and `restorePipelineStepCreate` + `countPlacementsForStep`.
- `restorePipelineStepCreate` reads a placement count before `pipelineService.deleteStep` and returns it as
  `resultingState: {"removedPlacementCount": n}`. It only runs after `ifStillUnbound` has re-checked that no panel and
  no Output/step the set did not create would be deleted. A patch set cannot target a step it creates in the same set
  (`PatchSetUndoLaterChildren` header; `PatchSetRefs` resolves `$ref` only from a panel create to an earlier Output
  create), so no Output can sit on the step at this point and the count is 0. It can be non-zero only if a racer binds
  between the re-check and the read, the accepted residual window documented at `ifStillUnbound`; in that case the
  panel is deleted by the cascade regardless of the count.
- Only `PatchSetUndoLaneSpec` line 138 reads the field. The web client (`patchSetsSlice.ts`) and helio-mcp
  (`types.ts` `EditUndoOutcome.resultingState?: Record<string, unknown>`) never read it. The undo response schema
  already says `resultingState` is absent for a restored create-undo.

## Goals / Non-Goals

**Goals:** the three ticket ACs plus the driver-listed tidy items, every one behaviour-preserving except the deliberate
wire removal of `removedPlacementCount`.

**Non-Goals:** any refusal rule/message change; closing the residual race window; renaming
`PipelineStepRepository.deleteInternal`'s internal `Option[Int]` (a removed-step count, misdocumented as
`removedPlacementCount`; PR note only); frontend, helio-mcp or schema file edits.

## Decisions

**D1 — Remove `removedPlacementCount` rather than keep it.** A field that is 0 on every reachable path, and non-zero
only in a race where the damage is already done and no other create-undo arm (Output, pipeline, dashboard) reports
anything comparable, is not a signal a client can use. Removal makes the step create-undo match the shared create-undo
shape (`restored`, `newId` = deleted id, no `resultingState`) the schema already documents. `restorePipelineStepCreate`
becomes `restoreCreateUndo(edit, id => pipelineService.deleteStep(PipelineStepId(id), user).map(_.map(_ => ())))`
(or the equivalent preserving `restoreCreateUndo`'s missing-`newId` and error-message shape — the executor must diff
the two `Left` messages: today the missing-newId message is `edit N (pipelineStep create): journal is missing its
captured newId` and a delete failure goes through `restoreFailed`; keep both strings byte-identical, writing the arm
by hand if `restoreCreateUndo`'s strings differ). `countPlacementsForStep` is deleted; drop `panelRepo.countByOutputIdsInternal`
only if it then has no other caller (it likely does; check). Alternative rejected: keep it and document it as a race
indicator — it would advertise a guarantee nothing tests.

Red first (wire change): change `PatchSetUndoLaneSpec`'s line-138 assertion to `resultingState shouldBe None` and see it
fail on current code; then implement. Seam: add a route-level assertion in `PatchSetUndoRoutesSpec` (or a new small
spec) that the serialized undo body for a restored `pipelineStep` create-undo has no `resultingState` key and
validates against `schemas/patch-sets/patch-set-undo-response.schema.json` if the repo already has a schema-validation
helper for route specs (use it; do not add a new validator dependency). The red for the seam assertion must also be
shown on current code.

**D2 — Split by restore family, keeping the walk and its logger in the service.** Move the update restorers and the
delete restorers (`restorePanelUpdate`, `restoreDashboardUpdate`, `restoreDataSourceUpdate`, `restorePipelineUpdate`,
`restorePipelineStepUpdate`, `restorePanelDelete`, `restorePipelineStepDelete`, `restoreBoundOutputs`, and the shared
`missingPriorState`/`restoreFailed` helpers if both sides need them — put shared helpers in one place, e.g. a small
object) into a new `final class PatchSetUndoRestorers` (name at executor's discretion, same package), constructed by
the service from the dependencies it already holds. `undo`, `restoreAll` (owns the only `log.error`, whose logger name
specs attach `ListAppender`s to), `restoreOne`, the guard wrappers, the create-undo arms and `deleteCreatedOutput`
stay. The service constructor signature, `context`, and every public/`private[services]` member stay unchanged (fixtures
and `OutputRepositoryRequiredSpec`/wiring specs construct it). Method bodies move verbatim; only visibility and
receiver change. Target: every touched source file at or under ~300 lines, the service near 250.

The split commit touches NO test file. Before it: run the full undo spec set (D4) and commit the record. After it: the
same set, same test count, all green, committed.

**D3 — Tidy items (behaviour-preserving):**
- `dataSource` create arm: wrap across lines / extract a named private helper; same expression.
- `ConcurrentHashMap`: thread an immutable `Map[Int, JournaledCreatedDataset]` through `loop` exactly as `children`
  is, return it in the `Right` tuple, and pass it to `journalSuccess` (change its parameter type; `createdDatasets.get`
  → `.get(edit.index)`). The failure branch never read it. Do this only if it compiles to the same journaled rows; the
  existing HEL-1796 apply/journal specs are the check.
- Warning text: "could not record the steps, Outputs and roots the pipeline create made". Check no test asserts the old
  text (none found at planning).
- `doomedOutputIds`: align `=>` columns.
- `describeRoot` comment: verify data sources have no grant/sharing table or RLS sharing policy (migrations, RLS policy
  for `data_sources`); if confirmed, say owned == readable, so the owner-scoped read is the readable set. If sharing
  exists, do NOT change behaviour: correct the comment to the truth and raise it as a follow-up.
- `PatchSetUndoLaneSpec` 84-86 comment and the `restorePipelineStepCreate` doc: describe HEL-1720/HEL-1795 refusal.

**D4 — The undo spec set** (C12 record): every `backend/src/test/**/PatchSetUndo*Spec.scala`, `PatchSetUndoRoutesSpec`,
`PatchSetApply*Spec` (apply service is touched), `OutputRepositoryRequiredSpec`, and any spec that constructs
`DraftUndoRlsFixture`/`AssistantStandingsFixture` users of the service. Enumerate the exact list with a command, commit
the list and the sbt output (as `.txt`) with per-suite and total test counts, under the change dir
(`openspec/changes/tidy-patchset-undo-service/evidence/`). Run in shards that finish under 600 s.

**D5 — Guard tests** (test-only, pass on current code, each with a recorded mutation that turns it red, labelled
"guard" in the test name/comment):

(a) HEL-1796 — a form-panel reference keeps an inline root that has later work, without refusing. Current behaviour
(`PatchSetUndoDatasetLaterWork.inlineFindings`: a referenced source is skipped; canonical `patch-set-undo` "Undo SHALL
skip a source that still exists and is referenced by anything other than the pipeline being undone"): set up a
`pipeline` create with an inline `dataset` root; after the apply, append a row to that source (the later work that
WOULD refuse if the source were unreferenced); then bind a `form` panel to the source. Expect: the undo SUCCEEDS, the
pipeline is gone, the outcome's `inlineSources` lists the source `kept`, and the source and all its rows remain.
Mutation: drop `refs.panels.nonEmpty` from `referenced` in `inlineFindings` → undo refused with the inline later-work
conflict → red. (Without the appended row the mutation would not bite; keep it.) Closes the gap HEL-1796's
`skeptic-final-2.md` named.

(b) HEL-1811 — inline roots the pipeline create made are excused. Existing `PatchSetUndoLaterAlertRulesSpec` tests
(":285 excuse the roots the create itself made (several)", ":316 excuse the journaled rootIds regardless of
timestamps") use `sourceId` roots only; record that in the evidence, then add an inline-root variant: pipeline create
with inline root(s), nothing added since → undo succeeds and the roots are not reported as later work. Mutation: make
the `Some(ids)` branch of `rootExcused` in `PatchSetUndoLaterChildren` excuse nothing (`case Some(ids) => false`) —
NOT a mutation that yields `None`, because the `created_at <= appliedAt` fallback would still excuse the roots → red.

## Risks / Trade-offs

- [A moved method silently changes logger or implicit EC] → logger stays in the service; the new class takes the same
  implicit `ExecutionContext`.
- [Wire removal breaks an unknown consumer] → schema already says absent; grep of frontend/helio-mcp/e2e found no reader.
- [Split commit accidentally edits a test] → `git diff --stat` of that commit must list no `src/test` path.

## Planner Notes

Self-approved: removal over retention (D1); spec handled as REMOVED+ADDED because the validator refuses a MODIFIED that
drops the old cascade scenario. Any real bug found while tidying becomes a follow-up via triage, never a silent fix.

Design-gate round 2 notes folded in: (1) D5(b) — `PatchSetUndoInlineDatasetLaterWorkSpec:202` already undoes a pipeline
create with an inline root and also reddens under `case Some(ids) => false`; the evidence must say so; make the new guard
multi-root and assert no root appears in `PatchSetUndoLaterChildren.blocking(...).roots` so it is not a duplicate.
(2) D1 seam red comes from the "no `resultingState` key" assertion (schema validation alone stays green); record which.
