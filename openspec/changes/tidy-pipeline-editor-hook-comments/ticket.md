# HEL-1484: After HEL-1478/1481: stale comments in the split pipeline-editor hooks; second EMPTY_OUTPUTS; oversized characterization test

## Description

These follow-ups came from HEL-1481 (matto00/helio#933, 5dceeae9d) and HEL-1478 (matto00/helio#932, a29a7e5ce). Both
splits moved code byte for byte, so stale comments came along unchanged. Re-derive every line number from main before
editing.

**Comment-only**

1. `useStepCardState.ts` has an "eight per-op-kind" header, and `useStepCardPersist.ts:34` says "20 change handlers"
   when there are 26.
2. `usePipelineShapeInstantiation.ts` has leftover `anchorHasTail` references.
3. `usePipelineDetailPage.ts:130-131` says the SSE `onTerminal` handler is "defined below", but it now lives in
   `usePipelineRunStream.ts`.
4. Some rewritten comment lines run to about 150 columns, for example `usePipelineStepCreation.ts:41`.

**Small code tidy-ups**

5. `PipelineRiverView.tsx:44` declares a second `EMPTY_OUTPUTS`, so the pointer at `usePipelineOutputSheets.ts:25-26`
   is incomplete. Share a single constant if that changes no behaviour (it's a stable identity used in deps; prove it).
6. The HEL-1481 characterization test is 1204 lines. Move its data tables to a fixtures file without weakening any
   assertion.

**Investigate (also present on base)**

7. After a forced 422 on a fillnull step save, a second identical convertformat PATCH is sent. Confirm whether it's
   redundant, and fix it only if that's trivial and behaviour-preserving; otherwise file it separately.

No behaviour change except item 7, if fixed.

## Acceptance Criteria

- AC1: Items 1-4: every listed stale comment is corrected against current main (line numbers re-derived); the same
  stale "20 change handlers" in `useStepCardState.test.ts` header is corrected too; no comment line added or touched by
  this change exceeds 120 columns. Comment-only: no code token changes in those files. The `anchorHasTail` comments
  state only probe-proven facts (design Decision 1); if the shape/lane reparent hazard is real, a Follow-up bug is filed.
- AC2: Item 5: exactly one module-level `EMPTY_OUTPUTS` sentinel serves both `ui/LaneColumn.tsx` and
  `ui/PipelineRiverView.tsx` (premise found a third copy in LaneColumn and a private one in `outputsSlice.ts`); the
  `usePipelineOutputSheets.ts` pointer names the real location. A test proves the zero-Outputs default passed to
  `StepCard` is the same reference across renders, and that test fails when the sentinel is replaced by an inline `[]`.
- AC3: Item 6: the characterization test's data tables (`EXPECTED_KEYS`, `HANDLER_CASES`, `EMIT_CASES`, `RESYNC_ROWS`
  and their helpers/types) move to a fixtures file; the test file keeps every `describe`/`it`/`expect`; the number of
  executed tests and assertions is unchanged (before/after `--json` counts); a mutation of a moved table row makes the
  corresponding test fail.
- AC4: Item 7: reproduced (or shown not reproducible) with evidence; either fixed with a test that fails first and is
  behaviour-preserving otherwise, or filed as a separate ticket with the repro.
- AC5: No new `eslint-disable`; lint (zero warnings), typecheck, prettier, and jest pass.
- AC6: Scope excludes HEL-1501 (no split of `usePipelineDetailPage`/`pipelinesSlice`, no settled-render helper dedupe).
