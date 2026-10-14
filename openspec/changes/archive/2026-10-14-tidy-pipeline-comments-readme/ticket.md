# HEL-1451: After HEL-1429: stale gatedSubmit / "sole production caller" comments; pipelines README missing PipelineAutoRunDebounceFirer; hel813 Connectors e2e flake

## Description

Origin: HEL-1429 (matto00/helio#895, 03588796), lane-reported. Priority Low, label Follow-up.

1. The `gatedSubmit` comment should name the submit branch's `transform` specifically.
   `PipelineRunBackfill.scala:69` calls OutputService the "sole production caller", but it actually calls in via
   PipelineRunService's pass-through. Fix both.
2. `backend/src/main/scala/com/helio/services/pipelines/README.md` doesn't list `PipelineAutoRunDebounceFirer` (the
   list was already incomplete). Re-derive it from the tree.
3. FireTimeRunConfigGateSpec (458 lines) uses section banners that CONTRIBUTING reserves for ~1000+ line files
   (pre-existing). Remove them or justify keeping them.
4. Possible e2e flake: `hel813-mobile-touch-target-floor.spec.ts:298`, "surface 7: Connectors page" at 430px: the
   "Add connector" dialog stayed visible after "Create connector" (passed on re-run). Root-cause it if it recurs.

## Driver instructions (2026-10-14)

- The ticket is 5 days old: re-derive every item against the current tree; drop any already fixed, with evidence.
- Item 2: re-derive the README list from the tree with a command.
- Item 4: root-cause only if it reproduces. Try a bounded number of repeats under the Playwright cap (<= 2 workers)
  and record the attempt; if it does not reproduce, document that and leave it.
- Comments must meet the HEL-1156 standard (no completeness claim the code does not back; name the known layers; give
  a re-derive command), with a verification command for each factual sentence (recorded in the change's evidence).
- Non-UI, no behaviour change.

## Acceptance Criteria

- AC1: The `gatedSubmit` comment in `PipelineSchedulerService.scala` names the submit branch's inner `transform`
  (not the outer `transformWith`), and every factual sentence in it is verified.
- AC2: `PipelineRunBackfill.scala`'s explicitRootId comment no longer calls `OutputService` a direct caller; it names
  the `PipelineRunService.backfillOutputNode` pass-through. The duplicated copy in `PipelineRunService.scala` is
  checked and left accurate.
- AC3: `services/pipelines/README.md` names `PipelineAutoRunDebounceFirer` and every other `.scala` file in the
  directory as re-derived by a recorded command, makes no completeness claim, and carries the re-derive command.
- AC4: FireTimeRunConfigGateSpec's four section banners are removed (459-line file, under CONTRIBUTING's ~1,000-line
  threshold), with any load-bearing information they carried (red-first base commit, GUARD meaning) preserved in a
  normal comment or the test/`should` names; test count and names unchanged otherwise.
- AC5: Item 4: a bounded repro attempt (recorded command, repeat count, worker cap, pass/fail per run) is in the
  change's evidence; root-caused and fixed only if it reproduced.
- AC6: No production behaviour change (comment/README/test-comment edits only, unless AC5 found a real defect).
