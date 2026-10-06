# HEL-1345: Trunk step create with rootId ignores position and splices at root head (CONFIRMED by probe) — every UI append lands at head

## Description

origin_kind: followup — origin_ticket: HEL-1340. Labels: Follow-up, Bug. Priority: High.

`PipelineService.persistNewStep` matches on `(parentStepId, rootId)`. Its `(None, Some(rootId))` arm never reads
`req.position` and calls `PipelineStepRepository.spliceInsertReportingInternal(..., parentStepId = None,
explicitRootId = Some)`, which reparents every parentless step of that root under the new step, so the new step
becomes the root's head. The frontend sends `rootId` on every root-0 trunk create, insert or append
(`handleInsertStep` in `usePipelineDetailPage.ts`, `pipelineService.ts`), so every UI insert or append lands at the
head on the server. The UI looks right until a resync. The `rootId` scaladoc says the step becomes "a trunk
continuation of THAT root", which contradicts the code. The only route test that sends `rootId` uses an empty root.

Probe (HEL-1340 lane, persisted at `.concertino/runs/HEL-1340/evidence/openspec/changes/pipeline-step-create-followups/probe.md`),
trunk A->B->C on a single-root pipeline:
- `{rootId, position: 2}` -> NEW->A->B->C (reparented: A)
- `{rootId}` -> NEW->A->B->C (reparented: A)
- `{position: 2}` (no rootId) -> A->B->NEW->C (correct; control)

Driver scope additions (2026-10-06):
- HEL-1340 item 4 moved here by owner ruling (HEL-1340 escalation answer `H2-move-ac4-to-hel1345`): "A draft created at
  an insert position does not resync, so other steps the server reparents stay stale on screen." The reconcile must
  keep local-only steps (the `handleReorderSteps` rule) and carry `renderKey`; HEL-1340's handed-over hazards (stale
  `stepsRef` on resync; overwriting a step's latest local config; a wholesale replace dropping local-only steps,
  including in `handleInsertStep`'s existing create-immediately resync) travel with it.
- Do not change HEL-1294/HEL-1321 behaviour (expand stays disabled while creating; `renderKey`).
- Backend first; check HEL-1340's `usePipelineStepCreation` extraction status through the driver before editing
  `usePipelineDetailPage.ts`.

## Acceptance Criteria

- AC1: A route-test probe: a root with existing steps, create with `rootId` plus an explicit `position`; record where
  the step lands. (Done by HEL-1340's lane: probe.md. Re-recorded here as the red run of AC2's test.)
- AC2: Honour `position` for `rootId` creates; with no `position`, append at the trunk tail of THAT root. The route
  test is red without the fix and covers a root with existing steps, with and without `position`, and multi-root
  pipelines.
- AC3: Check whether production data already has misplaced steps (read-only). Any data repair needs an owner ruling:
  escalate, write no migration.
- AC4: Fix the scaladoc (and in-code comment) to match the behaviour.
- AC5 (HEL-1340 item 4): once the server places steps correctly, a draft created at an insert position resyncs with
  the server so steps the server reparents do not stay stale on screen, without dropping local-only steps and while
  carrying `renderKey`. Needs a red test before the fix.
