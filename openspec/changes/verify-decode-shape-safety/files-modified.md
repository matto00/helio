- `backend/src/main/scala/com/helio/services/patchsets/RefinementEditShape.scala` — added four new worked UPDATE examples (`JoinStepExample`/`PivotStepExample`/`UnpivotStepExample`/`WindowStepExample`), unconditionally, extending the aggregate/groupby worked-example prompt-grounding to join/pivot/window/unpivot, and wired each into `Description`'s worked-examples text.
- `backend/src/test/scala/com/helio/services/patchsets/RefinementEditShapeSpec.scala` — added one decode-and-assert-actual-values regression test per new example, decoding through the real `JoinConfig.decode`/`PivotConfig.decode`/`UnpivotConfig.decode`/`WindowConfig.decode`.
- `openspec/changes/verify-decode-shape-safety/tasks.md` — marked all tasks complete.
- `openspec/changes/verify-decode-shape-safety/live-trials.md` — cycle-2 durable evidence: exact prompts,
  returned `patch.config` per trial (11 trials across join/pivot/unpivot/window), and pass/fail verdicts
  against the real decoders (design.md D1 / tasks.md 2.5), addressing evaluation-1.md change request 1.
  Also persisted to `.concertino/runs/HEL-671/evidence/` via `persist-evidence.sh`.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetPreviewServiceSpec.scala` — added a
  join-specific negative-control test proving a wrong-shape edit (missing `joinKey`) passes
  `PatchSetPreviewService.preview` despite the degraded decode (skeptic-final-1.md CR-2).
- `openspec/changes/verify-decode-shape-safety/live-trials.md` — corrected the "Overall verdict"
  over-claim to the narrower, actually-supported statement per skeptic-final-1.md CR-3.
