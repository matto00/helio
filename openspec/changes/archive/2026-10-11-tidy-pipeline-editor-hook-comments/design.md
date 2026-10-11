## Context

Premise validation (`.concertino/runs/HEL-1484/evidence/premise-validation.md`) on main 16736deb2: every claim holds,
line numbers drifted. Current sites: `useStepCardState.ts:5,7` ("eight per-op-kind", "eight typed change handlers");
`useStepCardPersist.ts:35` and `useStepCardState.test.ts:4` ("20 change handlers"; the characterization test asserts
26: `covers all 26 handlers`); `usePipelineShapeInstantiation.ts:53,76,92,133` (`anchorHasTail` appears only in
comments, no code identifier remains); `usePipelineDetailPage.ts:155-156` ("onTerminal closure (defined below"),
the closure lives in `usePipelineRunStream.ts`; `usePipelineStepCreation.ts:41` (160 cols).
`EMPTY_OUTPUTS` exists three times: `ui/LaneColumn.tsx:24` and `ui/PipelineRiverView.tsx:44` (`Output[]`, used as the
`outputs` prop default for `StepCard`), and private `state/outputsSlice.ts:375` (`readonly Output[]`, selector default).

## Goals / Non-Goals

**Goals:** accurate comments; one shared per-step zero-Outputs sentinel with proven stable identity; a shorter
characterization test with identical assertions; a resolved answer for item 7.

**Non-Goals:** HEL-1501 scope; any behaviour change other than item 7.

## Decisions

1. **Comments describe what is true now, not history.** Replace "eight" with a count-free phrase or the real number,
   and "20" with 26 (verified by the 26 handler keys in `EXPECTED_KEYS` and `covers all 26 handlers`). Re-point
   "defined below" to `usePipelineRunStream.ts`.
   **`anchorHasTail` (item 2) is a probe, not a rewording.** Lines 76-81 say the refusal was removed in HEL-912, yet
   lines 53, 88-93 and 133-137 still rely on it ("no reparenting exposure", "No resync needed"). Without
   `attachAsTail`, the backend splices the new step in and reparents ALL of the anchor's children
   (`PipelineStepCreate.scala` ~231-243, `spliceInsertAtInternal`), and "+ lane" is offered on every step
   (`usePipelineLaneStepCreation.ts`), so the shape anchor (last primary-lane step, `PipelineRiverView.tsx` ~494) can
   have lane children. The executor must probe this: which create call the shape makes for its first step (with or
   without `attachAsTail`), and, on a pipeline whose last primary step has a lane child, whether applying a shape at the
   bottom trigger reparents that lane server-side while the UI keeps the old structure (live UI + DB/API read, or a
   jsdom test asserting the request bodies plus a backend-level fact check). Comments are then rewritten to state only
   proven facts (no claim of a guard that does not exist, no "No resync needed" unless proven). If the hazard is real,
   file a Follow-up bug (label Follow-up, relatedTo HEL-1484) with the repro and make NO code change here; the comment
   may name the hazard and the follow-up ticket id.
2. **Line-length scope.** Re-wrap comment lines over 120 columns in the files this change touches, plus the split
   hooks listed in HEL-1481/1478 (`hooks/usePipeline*.ts`, `hooks/useStepCard*.ts`, `hooks/stepCard*.ts`). Measure
   with `awk 'length>120'` before/after and record both outputs. Code lines are left to prettier.
3. **One per-step sentinel.** Export `EMPTY_OUTPUTS` from a single owner and import it in LaneColumn and
   PipelineRiverView. Preferred owner: `state/outputsSlice.ts` (it already owns the selector-side sentinel and the
   `selectOutputsByStepId` contract); export the existing constant if its `readonly` type can flow to the `StepCard`
   `outputs` prop without a cast that hides mutation, otherwise export a separate named constant from the same module
   and say why in a one-line comment. Executor picks, records the choice in `files-modified.md` notes, and keeps it
   type-safe (no `as any`).
   **Identity guard (not red-first: identity already holds on base, since each copy is module-level; the change only
   collapses the copies into one).** There are three call sites: `LaneColumn.tsx` ~238 and ~295 (different render
   branches) and `PipelineRiverView.tsx` ~400. The guard test(s) must reach all three: for each, render with a
   zero-Outputs step, re-render, and assert the `outputs` prop handed to `StepCard` (captured via a `jest.mock` of
   StepCard or an existing seam) is `toBe(<shared export>)` on both renders and the same reference across renders.
   Mutation: replace the sentinel with inline `[]` at each site separately (three mutations) and show the
   corresponding assertion goes red each time; revert. Label it a guard in the test comment and evidence. Keep the
   `outputsSlice.ts` and `usePipelineOutputSheets.ts` comment mentions consistent with whichever owner is chosen
   (a `readonly` slice constant needs a cast for the `Output[]` prop: if so, prefer a separate exported constant).
4. **Fixtures file.** Move `EXPECTED_KEYS`, `HANDLER_CASES`, `EMIT_CASES`, `RESYNC_ROWS`, `SECONDARY`, their types and
   pure builders into `hooks/useStepCardState.characterization.fixtures.ts` (not a `*.test.ts` file, so jest does not
   run it as a suite; confirm jest `testMatch`). Keep anything that references `jest.mocked(...)` or mocks in the test
   file. Proof: run the suite with `--json` before and after and record `numPassedTests`/`numTotalTests` and the count
   of `expect(` call sites; mutate one row of each moved table (one HANDLER_CASES payload, one EMIT_CASES payload,
   one RESYNC_ROWS value, one EXPECTED_KEYS key) and show each goes red; revert.
5. **Item 7: reproduce first.** Repro path: the HEL-1481 evaluator's capture script
   (`/home/matt/Development/helio/.concertino/runs/HEL-1481/evidence/eval1/app/capture.mjs`, pipeline with fillnull and
   convertformat-adjacent steps, route-fulfilled 422 on the fillnull PATCH), or a jsdom test at the StepCard /
   PipelineDetailPage level that forces a 422 on the fillnull PATCH and counts PATCHes per step. Identify the cause
   (which hook re-fires the convertformat persist, and why). Fix only if the change is a few lines, the root cause is
   probe-confirmed, and no other observable behaviour changes; the test must be red on base first. Otherwise file a
   Linear follow-up (label Follow-up, relatedTo HEL-1484) with the repro and root-cause notes, and change nothing.
   **Evidence bar.** `capture.mjs` never edits the convertformat card, so BOTH convertformat PATCHes are unexplained:
   the investigation must account for where each comes from (which card/hook, which trigger) and whether they also
   occur WITHOUT the forced 422, before calling the second redundant. A "not reproducible" finding must come from the
   original live `capture.mjs` path (servers via `start-servers.sh` on this run's ports, throwaway data with ids
   recorded and deleted by exact id), not only from jsdom. The fixtures file must be inside lint and typecheck
   coverage (check `tsconfig` include and eslint globs).

## Risks / Trade-offs

- A comment fix that asserts a guard which no longer exists would be worse than the stale one: Decision 1 requires
  reading the code first.
- Sharing the sentinel across modules couples UI files to the slice module; acceptable, it already imports selectors.
- Moving tables can silently drop rows; the before/after test counts and per-table mutations guard against it.

## Planner Notes

- Self-approved: fixtures file name/location; preferring `outputsSlice.ts` as the sentinel owner.
- Also fixing the identical stale "20 change handlers" in `useStepCardState.test.ts:4` (same class as item 1).
- Concurrent lanes HEL-1493/1070/1305 may touch nearby files; re-sync with origin/main before the PR.
