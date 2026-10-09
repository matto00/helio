# HEL-1429: After HEL-1384: relabel FireTimeRunConfigGateSpec undecodable-config tests, fix stale recover comment, split PipelineRunService.scala (652 lines)

## Description

Origin: HEL-1384 (matto00/helio#875, 99d6fedd), lane-reported. Low priority follow-up. Re-scoped after HEL-1393
(#888, 0f3b43bf) per the ticket comment (relayed by the driver; HEL-1393's own evidence corroborates each folded-in
item: `.concertino/runs/HEL-1393/evidence/.../skeptic-final-1.md` non-blocking notes).

1. `backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala`: the two undecodable-config
   tests are labelled GUARD ("green on main") but fail on main. Relabel them as red-first.
2. `PipelineSchedulerService.fire()`: a comment still refers to "this `recover`", which now lives in `gatedSubmit`.
3. `PipelineRunService.scala` is 652 lines and `PipelineSchedulerService.scala` is 314. Split along concern lines,
   behaviour-preserving. Check overlap with HEL-1393 first and combine if they collide.
4. Test note: `audit_events` is append-only, so specs must scope audit assertions by a unique pipeline id. Consider a
   MISTAKES.md line if it keeps biting.

Folded in from HEL-1393's follow-ups:

5. Stale describe/it names in `PipelineRunServiceSpec` (~:447, :547, :749, :2167, plus the comment at ~:2144 quoting a
   deleted describe title) that name members which moved out of `PipelineRunService`.
6. Delete `PipelineRepository.findPrimaryDataSourceIdInternal` if it truly has no callers.
7. Update the archived `forbidden-classification.md` pin note for the post-#888 producer split (PipelineRunService 1 +
   PipelineRunPreview 1).
8. Verify the remaining "Defaulted to `None`" comments (OutputProtocol:27, NodeSnapshotRepository:170, and the other
   hits) against reality; correct any that are false.
9. Optional: the imprecise `explicitRootId` "`None` ... for the single-root case" wording (PipelineRunService ~:278,
   PipelineRunBackfill ~:68).

## Acceptance Criteria

- Item 1: the two undecodable-config tests are shown failing on pre-HEL-1384 code (1bf11f55, the
  parent of HEL-1384's merge 99d6fedd) before being relabelled red-first; if either does NOT fail
  there, it stays a GUARD and the discrepancy is reported.
- Item 2: the comment names `gatedSubmit`'s recover accurately.
- Item 3: PipelineRunService half superseded by HEL-1393 (#888; now 386 lines). PipelineSchedulerService (314) is
  split along the auto-run-debounce vs cron-schedule seam, behaviour-preserving (design.md D1).
- Item 4: MISTAKES.md gains a line only if the hazard is shown to be real and recurring; otherwise reasoned skip.
- Items 5–9 addressed as described; any deletion shown to have zero callers (grep + compile).
- Behaviour-preserving: `sbt testFull` per-suite pass/fail counts identical before and after.
