## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 54f2943cd20b0ac26f3f1581bb1fcf15bfb8a8fc (equal to origin/main; the change dir is untracked planning only).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/auto-run-dropped-write-rearm/HEL-1504`.
- **Owner rulings:** `.concertino/runs/HEL-1504/events.jsonl` line 7 has `escalation.answered` for `HEL-1504-1791759145023-49a06d`, with `sub_answers` `["keep-pending-fire-after-run","retry-after-capped-N-then-drop-with-warn","no-writer-signal-here"]`, `answer_source":"human"` and `resolution_channel":"chat"`. Line 6 is an earlier `escalation.timeout`, which was superseded by the answer. D1, D2 and the Q3 non-goal implement Q1, Q2 and Q3 as worded. N=10 is a lane default and is disclosed as one.
- **Premise:** I read `PipelineAutoRunDebounceFirer.processAutoRunClaim`. The active-run branch calls `releaseClaim`, a compare-and-delete. The `TooManyRequests` branch logs at INFO and then always calls `releaseClaim`. Both drops are confirmed.
- **Token semantics:** `claimDue` sets `claimed_at = now` RETURNING the DB value. `upsertDebounce` sets `claimed_at = NULL` unconditionally, using GREATEST on `fire_at`. D1 `unclaim` and D2 `rearmAfterGuardRejection` compare on the same token. If a write landed mid-claim, they match zero rows, and the write already re-armed the row. This is sound. D2's update-or-delete can be done as one CTE statement with mutually exclusive predicates, which is implementable. The counting is right: maxRetries=10 gives 1 initial attempt plus 10 retries, and 0 restores drop-with-WARN.
- **Stale-claim interplay:** both new paths clear `claimed_at`, so the 300 s stale-reclaim never interacts with a re-armed or pending row in a single process. Ticks do not overlap there, because `PipelineSchedulerActor` arms the next tick only on `TickCompleted`. There is one multi-instance edge, covered in the non-blocking notes.
- **Guard clock (D6 determinism):** `PipelineRunService` has a `guardClock: Clock` param (HEL-1374). `PipelineRunExecutor` passes `guardClock.now()` into `incrementRateIfUnderLimit`. Rate buckets are epoch-aligned in app code, not SQL `now()`. `AutoRunGuardBurstProofSpec` already pins `guardClock` to the scheduler's clock. Pinning both clocks to one FakeClock therefore makes (b) and (d) deterministic, as D6 says.
- **Red on main:** on main, (a), (b) and (c) delete the row after the first post-due tick (`releaseClaim` on both paths). The "row still present" assertions are therefore deterministically red.
- **Concurrency cap counting:** `PipelineRunRepository.countAndInsertAction` counts the owner's runs with `status NOT IN ('succeeded','failed','dry_run')` across all owned pipelines. `hasActiveRunInternal` instead uses `completed_at IS NULL` on the one pipeline. The two predicates differ (CR 2).
- **Guard ordering:** in `PipelineRunExecutor.scala:131-167`, `incrementRateIfUnderLimit` runs and commits FIRST. `insertRunIfUnderConcurrencyCap` runs only after it returns `Right`, and a cap rejection does not roll the increment back (CR 1).
- **V125:** it is free. The latest migration on origin/main (`git ls-tree origin/main`) is V124.
- **Old-behaviour encodings:**
  - Live spec `openspec/specs/dataset-write-auto-run/spec.md` scenario "A guard-rejected auto-run's debounce claim is released without a retry storm" is replaced by the delta. The MODIFIED header matches the live requirement verbatim.
  - The `pipeline-run-guard` spec's auto-run scenario stays consistent: every retry is still rejected exactly like a manual run, and the run count stays within budget.
  - Tests: `AutoRunGuardNoRetryStormSpec` is named. `DatasetWriteAutoRunEndToEndSpec.scala:~254` (`stillClaimed shouldBe false` after a zero-limit guard rejection) also encodes the old drop, but it is NOT named (CR 3).
  - `AutoRunGuardBurstProofSpec` (runCount 3 and rateWindowRequestCount 3 at a 300 s window) should still hold. A rejected fire re-arms to the window end, later burst writes coalesce under GREATEST, and the clock never passes the window.
  - `FireTimeRunConfigGateSpec`'s row-removed assertions cover verdict denial, which is unchanged.
- **Placeholders/contradictions:** none found. Tasks cover every AC: (a), (b) and (c) in the repro, bounded and no bypass via D2, D5 and C3, and the rulings.

### Verdict: REFUTE

### Change Requests

1. **D2's cost claim is false for concurrency-cap rejections. Correct it, and make an explicit decision about the real cost.**
   - **The claim:** design.md D2 says "Rejected submits do not increment `pipeline_run_rate_window`, because only successful acquisitions do. A retry therefore costs one guard check, never budget." D4's sizing rests on it.
   - **What the code does:** that holds only for a rate-limit rejection. `PipelineRunExecutor.scala:133-136` commits the rate increment before the concurrency check at `:150-167`. Every concurrency-cap-rejected attempt therefore consumes one of the owner's rate slots, including every D2 retry.
   - **The cost:** effective retry spacing is max(15 s advisory, 30 s tick) ≈ 30 s, so each blocked pipeline burns about 2 of the owner's 10 slots per minute, up to 10 extra slots per write. helio-news (the reporting case) has 3 dependent views. While its owner sits at the cap, that is about 6 of 10 slots per minute spent by automated retries. Rate slots spent this way can then rate-limit the owner's manual runs, and the retries themselves.
   - **Required revision:**
     - (i) Fix the D2 and D4 text.
     - (ii) Decide explicitly, and record it in design.md, whether this cost is accepted (with the quantified worst case) or mitigated within the Q2 ruling. One mitigation is a longer or growing retry spacing for the concurrency-cap reason, while still always going through `submit`. Reordering the HEL-505 guards is out of scope.
     - (iii) Pin the decision in D6 case (c) with an assertion on `pipeline_run_rate_window.request_count` after the rejected attempts, so the cost is measured rather than asserted.
2. **D6 must name what "complete the run" writes, because the two in-flight predicates differ.** `hasActiveRunInternal` keys on `completed_at IS NULL`, while the concurrency cap keys on `status NOT IN ('succeeded','failed','dry_run')`. In case (a), a fixture that only flips `status` leaves the D1 row pending forever. In case (c), one that only sets `completed_at` never frees the slot. Either mistake yields a red-after-fix or a vacuous test. Specify that seeded in-flight runs use status `running` with `completed_at NULL`, and that "complete" sets a terminal status AND `completed_at` (or uses `updateRunTerminal`).
3. **List every existing test that encodes the old drop.** Proposal Impact and task 3.4 should name `DatasetWriteAutoRunEndToEndSpec`'s guard-rejection case, which asserts the debounce row is gone after a zero-limit rejection (around line 254). After the fix that row is re-armed, so the test must be rewritten to the re-arm contract, not deleted. Task 3.4's grep would likely surface it. Name it anyway, so the evaluator can check it off rather than infer it.

### Non-blocking notes

- **Multi-instance stale reclaim + D1.** If a fired run's `submit` outlasts `staleClaimAfterSeconds` (300 s), a second instance can re-claim the stale row. It sees the active run and, under D1, unclaims instead of deleting. The first instance's `releaseClaim(oldToken)` then matches zero rows, so one extra follow-up run fires with no new write. This is bounded (one run) and within the Q1 duplicate trade, but the Risks bullet "serialize exactly as before" is not quite true. Mention it there.
- **Env var fallback.** `PIPELINE_RUN_AUTO_RUN_MAX_RETRIES` falls back for non-numeric or `< 0`, while the sibling `PIPELINE_RUN_*` rows fall back only for non-numeric. The difference is fine, but the CLAUDE.md row should state the fallback exactly as implemented.
- **Retry spacing.** The real spacing is max(Retry-After, scheduler tick). The D4 arithmetic ("~150 s" for the cap) understates the wall-clock span: with the default 30 s tick it is about 5 min. Worth correcting alongside CR 1.
