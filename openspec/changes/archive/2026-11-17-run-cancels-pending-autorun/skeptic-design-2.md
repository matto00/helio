## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD ff667dd571ce2f86ba3298c2f742f1f08c138c22. The planning artifacts are untracked in the worktree.

### What I verified (with evidence)

- **Round-1 CR1 (sequence grant) is addressed.** D1 and task 1.1 now state the explicit
  `GRANT USAGE, SELECT ON SEQUENCE ... TO helio_privileged`. Task 4.4 and test-plan item 4 prove it with
  `has_sequence_privilege` through `ProductTelemetryDbHarness`, and the test is made red by removing the GRANT.
- **Round-1 CR2 ("if and only if") is addressed.** The spec delta is now a one-way guarantee tied to the admission
  snapshot, with an explicit MAY for the case where a write committed but its upsert landed late.
- **Round-1 CR3 (start boundary) is addressed** by option (i). The snapshot is now taken just before the admission call.
  `PipelineRunExecutor.scala:164-171` shows the admission call sits outside any transaction the design touches, and the
  refusal arms (:180-187) can simply discard the snapshot.
- **Round-1 CR4 (awaited cancel) is addressed.** D3 and task 2.2 sequence the cancel into `writesChain()`'s `chain` and
  the `deletedRecovery` siblings (PipelineRunSucceededWrites.scala:74, :252, :296-298), before `succeeded` is
  published (:311).
- **There is a single real-run path.** The only call sites of `runPipeline` are PipelineRunService.scala:184 and :190.
  The only real-run `backend.execute` is PipelineRunExecutor.scala:256. The other `.execute` callers are preview and
  backfill (PipelineRunPreview.scala:198/:280, PipelineRunBackfill.scala:121/:138), which correctly never cancel. So the
  manual, scheduled, hook and auto-run triggers all reach the hook.
- **The repo statements match D1's claims.** `upsertDebounce` is INSERT ... ON CONFLICT DO UPDATE
  (PipelineAutoRunDebounceRepository.scala:38-43). `rearmAfterGuardRejection` is UPDATE/DELETE and never re-INSERTs
  (:108, :113), so a re-arm cannot draw a new DEFAULT generation. `unclaim` and `claimDue` are UPDATEs. `releaseClaim`
  is a compare-and-delete on `claimed_at` (:77). Using `EXCLUDED.write_generation` on conflict is sound: the DEFAULT
  is evaluated for the proposed row, so a fresh value is drawn on both paths.
- **The auto-run's own run is safe.** The firer claims the row, and the auto-run's real run snapshots generation g.
  On success it deletes the row on g, after which the firer's `releaseClaim` matches nothing. A write during the
  auto-run bumps g and sets `claimed_at = NULL`, so it survives, as it does today.
- **The existing HEL-1504 tests are compatible.** `DatasetWriteAutoRunDroppedFireSpec` (a) and (f) (:183, :354) seed the
  in-flight run directly (`seedInFlightRun`, not through `executeRun`) and write after it. No snapshot or cancel
  happens, so they stay green.
- **The e2e call sites are confirmed** at hel1277 spec :6 (import), :122, :130, :276, plus the helper at
  historySeed.ts:84.
- **The migration number is free.** The highest migration on base is V140.

### Verdict: REFUTE

### Change Requests

1. **The spec delta leaves a base requirement that now contradicts it (specs/dataset-write-auto-run/spec.md; base
   `openspec/specs/dataset-write-auto-run/spec.md:209-215`).** The base requirement "An auto-run that finds the
   pipeline already running fires after that run completes" says that when a pending auto-run comes due while the
   pipeline has an active run, the system "SHALL NOT discard the pending auto-run" and it "SHALL fire exactly once on
   the first scheduler tick after the active run completes". Take a write armed before a manual run's admission
   snapshot, whose debounce comes due while that run is in flight. The base requirement says the auto-run fires
   after the run. The new ADDED requirement says the run's success cancels it. Both are unconditional SHALLs. The delta
   only ADDs, so after archive the canonical spec would carry both. An evaluator or a future reader holding the
   HEL-1504 requirement would read the new behaviour as a regression. The ADDED requirement's closing clause ("a
   pending auto-run that a successful run cancels is simply no longer pending") does not name or override that
   requirement. Required revisions:
   - Add a `## MODIFIED Requirements` block that restates the HEL-1504 requirement in full, as OpenSpec MODIFIED
     requires. Add the carve-out that it applies unless the active run is a real run that succeeds and cancels the
     pending auto-run under the new requirement, because the write was armed before that run's admission snapshot.
     Keep its existing scenarios. Add one scenario: a write armed before a manual run, coming due while that run is in
     flight, does not fire after the run succeeds.
   - Update proposal.md "Modified Capabilities" to say that the HEL-1504 requirement is narrowed as well as the new
     requirement being added. Also qualify the proposal's and design's "HEL-1504 ... untouched" wording: the firer
     mechanics are untouched, but that requirement's outcome changes for writes the run read.
   - Optionally, check the first base requirement (":14-16", "coalesce into exactly one eventual run"). It reads as an
     upper bound and probably needs no change, but say so in the design if it is left alone.

### Non-blocking notes

- Test-plan item 2 ("a test backend/hook arms a write after the snapshot and before success") needs a seam inside
  `runAdmitted`/`backend.execute`, such as a test `PipelineExecutionBackend` that calls `upsertDebounce` from
  `execute`. The executor should pick it deliberately so the test is not a race against timing.
- Consider adding one more test: a write armed before the run that comes due while the run is in flight, with a
  scheduler tick during the run. Assert that the row is unclaimed (HEL-1504) and then cancelled at success, with no
  second run. This is the exact interaction CR1 is about, and it also covers the "carve-out" scenario.
