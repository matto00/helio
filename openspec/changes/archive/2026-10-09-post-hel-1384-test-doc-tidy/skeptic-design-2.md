## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 2fb8deb5a0cefb9855262991db39fba9d3ebd1ec. The change dir is untracked, so the artifacts were read from disk.

### What I verified (with evidence)
- **cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/relabel-gate-tests-tidy-refs/HEL-1429`.
- **Round-1 CR1 (Item 3 scheduler half) is resolved by option (a).**
  - ticket.md AC "Item 3" now keeps the PipelineSchedulerService split in scope.
  - design.md D1 now states the PipelineRunService half accurately. It is superseded by #888, and CONTRIBUTING's ~250 budget is acknowledged as exceeded (386).
  - proposal.md and tasks.md section 3 agree with D1.
- **D1 split plan, checked against PipelineSchedulerService.scala at HEAD:**
  - The proposed seam is real. `processAutoRunDebounce`/`processAutoRunClaim`/`fireAutoRun` are at :125-191. `processCandidate` begins at :193.
  - The moved bodies never touch `inFlight`/`reserve`/`release` (:71-80). They reference `autoRunDebounceRepo`, `staleClaimAfterSeconds`, `runRepo`, `autoRunTriggerService`, `pipelineRepo`, `pipelineRunService` and `log`. All of these can be passed in, so D1c's guard concern does not apply and no state gets duplicated.
  - Logger name is preserved:
    - The scheduler uses `LoggerFactory.getLogger(getClass)` (:64). On a final class that equals `classOf[PipelineSchedulerService]`.
    - FireTimeRunConfigGateSpec:212 attaches its ListAppender to exactly that name.
    - D1b keeps the name, and the same pattern already ships in `PipelineRunBackfill.scala:24` (`getLogger(classOf[PipelineRunService])`).
  - No test reaches the moved private methods by name or reflection: `grep -rn "processAutoRunDebounce|processAutoRunClaim|fireAutoRun|PrivateMethod"` outside the file finds 0 hits.
  - PipelineSchedulerServiceMaintenanceHooksSpec:37 attaches its appender to `OutputHistoryRetentionService`, not the scheduler, so the split does not affect it.
  - No logback/resource config pins this logger: grep of `backend/src/{main,test}/resources` finds no logger entry.
  - D1a keeps the constructor and the `require`s (:58-62) unchanged. It builds the firer only when the repo is wired, which preserves the :126 no-op. The five auto-run specs (DatasetWriteAutoRunCoalescing/EndToEnd, AutoRunGuardNoRetryStorm/BurstProof, FireTimeRunConfigGate) therefore construct the scheduler unchanged.
  - After the move the file drops to roughly 245 lines, under the ~250 budget.
- **Round-1 CR2 (D3) is resolved.**
  - D3 now specifies the "<entry point the test calls> (<current owner>)" convention, decided per title by reading the test body.
  - It explicitly handles the still-public `previewStep` delegator.
  - The :2144 quote is now kept verbatim, with an appended note.
  - Titles confirmed present at PipelineRunServiceSpec:447, 547, 749, 2144 (comment) and 2167.
- **Round-1 non-blocking notes were absorbed:**
  - D2 names the scratchpad location, says HEL-1384's log is corroboration only, and classifies uncaught-exception failures explicitly.
  - D5 no longer claims an old numeric pin.
  - D9 records the base as 2fb8deb5.
- **Coverage:**
  - Every ticket item 1-9 maps to a task: 1->1.x, 2->2.1, 3->3.x, 4->4.2, 5->4.1, 6->3b.1, 7->2.2, 8->2.3, 9->2.4.
  - Every task has an acceptance signal: a red run, a grep plus compile, per-suite testFull counts, or a pure-move diff.
- **Other checks:**
  - No placeholders or TBDs found in proposal/design/tasks.
  - No API or schema change, so no contract delta is needed (`skip_specs` is appropriate).

### Verdict: CONFIRM

### Non-blocking notes
- The class scaladoc at PipelineSchedulerService.scala:21-22 says "See [[processAutoRunDebounce]]". After the move that link points at a member that no longer exists in this class. Retarget it to `PipelineAutoRunDebounceFirer` in the same commit. A pure-move rule (D1d) should not be read as forbidding this; leaving it would contradict the ticket's whole "refs must be true" purpose. The comments at :38-41 ("skips the auto-run claim-and-fire pass below") and :53-54 should be re-read for the same reason.
- D1d: verify the `.recover` placement stays exactly where it is now. Today the no-op branch and the claim pass are both wrapped by `tick()`'s `.recover` at :103. If the moved method were wrapped differently, a synchronous throw from `claimDue` would change behaviour. The pure-move evidence should show this.
- D9: a split in the scheduler touches timing-sensitive specs (AutoRunGuardBurstProofSpec, HEL-1439 flake). Treat the "re-run once" allowance strictly: a failure that also reproduces on base is the flake, and one that does not is a regression.
