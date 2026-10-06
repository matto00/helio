# HEL-1340: Pipeline editor step-create follow-ups: reorder renderKey test, extract usePipelineStepCreation, draft select placeholder, insert-draft resync

## Description

origin_kind: followup
origin_ticket: HEL-1321

The HEL-1321 lane noted these items. Verify each against main:

1. **Reorder test.** No committed test covers the `renderKey` carry in `handleReorderSteps`. The evaluator verified it
   with a probe; the source is in HEL-1321's `evaluation-2.md`. Commit that probe as an RTL test that goes red when the
   carry is removed.
2. **Hook size.** `usePipelineDetailPage.ts` is about 1600 lines. Extract the step-create and draft logic into a
   `usePipelineStepCreation` hook, without changing behaviour.
3. **Placeholder (existing bug).** While a draft's create is in flight, its input-field select shows the placeholder.
4. **Stale steps after insert (existing bug).** A draft created at an insert position does not resync, so other steps the
   server reparents stay stale on screen.
5. **Optional.** Move HEL-1294's create-immediately paths onto the stable-key mechanism, so the disable-expand
   workaround can go. **Needs owner ruling:** HEL-1294's behaviour was deliberately left as it is.

Items 3 and 4 each need a red test before the fix.

## Driver scoping (binding for this run)

- Scope is items 1-3 only. Item 5 is OUT of scope (needs owner ruling) and must not be done.
- Item 4 / AC4 MOVED to HEL-1345 by owner ruling 2026-10-06 (escalation answer `H2-move-ac4-to-hel1345`): a route-test
  probe (`probe.md`) confirmed the backend's `rootId` trunk-create arm ignores `position` and head-splices, so item 4's
  frontend reconcile only makes sense after HEL-1345's backend fix. HEL-1345 carries the backend fix and item 4.
- Item 2 is a behaviour-preserving refactor: every existing test passes unmodified, including the HEL-1294
  (`PipelineDetailPage.creatingStep.test.tsx`) and HEL-1321 (`PipelineDetailPage.draftCreate.test.tsx`) suites.
- Item 3 needs a probe-confirmed root cause and a red test before the fix.
- Item 2 (refactor) and item 3 (bug fix) land as separate commits, so the refactor diff can be reviewed alone.
- If item 2 proves large or risky, escalate early with a recommendation to split it into its own ticket.

## Acceptance Criteria

- AC1: A committed RTL test exercises a non-head reorder of a created draft step and asserts its card stays expanded; it
  is green at HEAD and red with the `renderKey` carry in `handleReorderSteps` removed.
- AC2: Step-create and draft logic lives in a new `usePipelineStepCreation` hook; `usePipelineDetailPage.ts` shrinks
  accordingly; no existing test file is modified by the refactor commit and all pass.
- AC3: While a completed draft's create request is in flight, its input-field select shows the selected field (not the
  placeholder). Red test before fix, root cause probe-confirmed.
- AC4: MOVED to HEL-1345 (owner ruling H2). Not delivered by this ticket.

## Premise validation

See `.concertino/runs/HEL-1340/evidence/premise-validation.md`. Verdict: no-drift.
