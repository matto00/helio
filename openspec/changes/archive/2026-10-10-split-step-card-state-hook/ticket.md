# HEL-1481: After HEL-1478: split useStepCardState.ts (~602) and trim usePipelineStepStructure.ts (271+)

## Description

origin_kind: followup
origin_ticket: HEL-1478

HEL-1478 shipped items 1-3 of its plan (the 7 hidden `react-hooks/refs` sites in `usePipelineDetailPage.ts`; the
debounced re-analyze effect moved out of the host; the host remainder extracted into sub-hooks). Its items 4 and 5 were
deferred here so it stayed one reviewable PR:

1. `frontend/src/features/pipelines/hooks/useStepCardState.ts` (~602 lines on 744c37720, grown by HEL-1422 / PR #912):
   split into focused sub-hooks.
2. `frontend/src/features/pipelines/hooks/usePipelineStepStructure.ts` (271 lines after HEL-1465, mostly verbatim
   comments). HEL-1478's D1c threads one more setter through it, so it grows slightly; trim it back under ~250.

**Added from HEL-1478's final review (non-blocking; ticket updated 2026-10-11T04:31Z):**

3. `usePipelineStepCreation.ts` is now 405 lines after HEL-1478's D1c, which threads the pending-draft-ids mirror
   through it. That is over CONTRIBUTING's ~400 threshold, so split it.
4. Comments now point at code that lives in another file, after HEL-1478's verbatim moves (left as-is, because
   rewording them would break HEL-1478's byte-identical split proof):
   - Made wrong by HEL-1478:
     - `usePipelineOutputSheets.ts:66-67` says "like the derived-state block above"; that block is in
       `usePipelineDetailPage.ts`.
     - `usePipelineDebouncedAnalyze.ts:97` says "see `pendingSinceRef`'s comment above"; that comment is in the host.
   - Already wrong on base:
     - `usePipelineOutputSheets.ts:26`
     - `usePipelineRunAndSaveActions.ts:46` and `:50`
   - Fix: a comment-only commit.

## Acceptance Criteria

Use the same behaviour-preserving proof standard as HEL-1365/1399/1430/1465/1478:

- byte-move check with red runs;
- hook primitive call sequence unchanged;
- deps arrays equal to base plus provably-stable additions only;
- tests import-only in split commits;
- a characterization test committed green on base first for any non-verbatim restructuring;
- running app compared before and after, in light and dark.

## Driver constraints (owner-backed)

- No new `eslint-disable`; zero-warnings lint holds. If an existing suppression hides errors a move would surface,
  escalate the options (as HEL-1478 did).
- Any real bug found becomes a follow-up ticket, not a fix in this PR.
- Items 1-3 use the proof standard below; item 4 is a comment-only commit.
- HEL-1483 (editor keeps previous pipeline's step cards after in-app switch) is a separate bug on base: do not fold in.
- Execution is gated on HEL-1478 merging to origin/main (it edits `usePipelineStepStructure.ts`); then re-sync and
  re-verify the premise. Never edit HEL-1478's worktree.
