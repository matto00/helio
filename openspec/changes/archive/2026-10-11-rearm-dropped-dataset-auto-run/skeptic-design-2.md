## Skeptic Report — design gate (round 2, skeptic-design-2.md)

I reviewed HEAD 54f2943cd20b0ac26f3f1581bb1fcf15bfb8a8fc. It equals origin/main. The change dir is untracked and contains planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/auto-run-dropped-write-rearm/HEL-1504`.
- **Owner rulings:** `.concertino/runs/HEL-1504/events.jsonl` line 7 is `escalation.answered` with `sub_answers` `["keep-pending-fire-after-run","retry-after-capped-N-then-drop-with-warn","no-writer-signal-here"]` and `answer_source":"human"`. D1, D2/D4 and the Q3 non-goal implement these rulings. I did not re-litigate them.
- **Premise is still accurate.** In `PipelineAutoRunDebounceFirer.scala:48-69`, the active-run branch calls `releaseClaim`, which deletes the row. The `TooManyRequests` arm inside `fireAutoRun` (`:86-91`) logs at INFO, and the outer `flatMap` then calls `releaseClaim`. `fireAutoRun` currently returns `Future[Unit]`, so implementing D2 needs it to surface the outcome. That is an implementation detail, not a design gap.

#### Round-1 CR1 (budget cost): addressed

- **Corrected text:** D2's "Budget cost of a retry" paragraph now states the real ordering. `PipelineRunExecutor.scala:133-136` runs the rate increment, which commits on `Right`. The cap check at `:150-167` comes after it. So a cap rejection inside `submit` consumes a slot, and the design says so.
- **D2a mirrors the guard predicate.** `countAndInsertAction` (`PipelineRunRepository.scala:162-182`) counts `runs.status NOT IN ('succeeded','failed','dry_run')` joined to `pipelines.owner_id = ownerUuid`. D2a names exactly this predicate and keys it by owner. It requires the predicate to be reused or extracted, not re-typed (task 3.1b). Auto-runs submit as the owner (`fireAutoRun` builds `AuthenticatedUser(pipeline.ownerId, ...)`), so `ownerRun = true` and the guard path is `insertRunIfUnderConcurrencyCap`, keyed by the same owner id. The owner keying matches.
- **D2a omits the advisory lock, which is acceptable.** It is a read-only pre-check. If the snapshot over-counts, the firer only defers. If it under-counts, the firer falls through to `submit`, which takes the real `pg_advisory_xact_lock` and is authoritative.
- **D2a is strictly conservative.** It can only withhold a submit. It never admits a run, because every run still passes through `submit` and therefore through both HEL-505 guards. That is not a bypass. The `pipeline-run-guard` invariant "total runs never exceed budget" still holds, because admission happens only in `submit`.
- **Threshold matches.** D2a re-arms when `count >= maxConcurrent`; the guard rejects when `!(count < maxConcurrent)`. With `maxConcurrent = 0`, both always reject, and the row drops after N attempts, which is bounded.
- **Ordering is right.** D2a runs after D1 (`hasActiveRunInternal`) and after the HEL-1384 verdict, so verdict-denied pipelines still drop without retry.
- **Measured, not asserted.** D6 case (c) now asserts that `pipeline_run_rate_window.request_count` is unchanged across the rejected attempt. On main, the cap rejection increments the rate window and deletes the row, so both assertions are red-first.
- **Config is available.** `PipelineRunGuardConfig` (`maxConcurrent`, `concurrencyRetryAfterSeconds`) is available for threading, and D4/task 2.2 add `autoRunMaxRetries` to it.
- **Residual TOCTOU is disclosed.** At most one slot is lost per lost race, the same as today.

#### Round-1 CR2 (fixture predicates): addressed

- The D6 fixture rule requires `status='running'` and `completed_at=NULL` for in-flight runs.
- "Complete" is defined as `updateRunTerminal*`. I verified `updateRunTerminalInternal` at `PipelineRunRepository.scala:271-283`: it updates `(status, completedAt, ...)` together, setting both columns.
- `hasActiveRunInternal` (`:466-469`) reads `completed_at IS NULL`. The fixture rule satisfies both predicates.

#### Round-1 CR3 (old-drop encodings): addressed

- D6 and task 3.4 name `DatasetWriteAutoRunEndToEndSpec`'s guard-rejection case. I confirmed it at `:254-255` (`stillClaimed shouldBe false`, `zeroGuard` with `rateLimitPerWindow = 0`, `maxConcurrent = 100`).
- `AutoRunGuardNoRetryStormSpec` is also named (`alwaysDeniedGuard`, `rateLimitPerWindow = 0`).
- I also checked the `tightGuard` case at `:207`. It asserts only `runCount(pid) shouldBe 1` under a pinned guard clock. Re-arming keeps the guard rejecting, so that case stays valid unchanged.

#### Round-1 non-blocking notes

- **Multi-instance stale reclaim:** now in Risks.
- **Retry spacing:** corrected in D4 to max(Retry-After, tick), about 5 min for the cap.
- **Env fallback:** task 2.3 instructs stating the exact rule.

#### Other checks

- **Spec delta:** the MODIFIED header matches the live requirement header verbatim (`openspec/specs/dataset-write-auto-run/spec.md:130`). The delta reproduces the full requirement, including the unchanged owner-attribution scenario.
- **V125:** still free. The `origin/main` migration tail is V124, and task 2.1 re-checks it.
- **No placeholders or TBDs.** Every AC (a)/(b)/(c), the bounded/no-bypass requirement and the rulings map to tasks 1.x, 3.x and 4.x.

### Verdict: CONFIRM

### Non-blocking notes

1. **Task 4.2's mutation claim for case (c) is wrong under D2a; the executor must correct it.**
   - **Why it is wrong:** with D2a in place, case (c) never reaches `submit`'s cap rejection. The pre-check takes the re-arm path directly. So "reverting the TooManyRequests branch turns (b)/(c) red" will leave (c) green.
   - **Correct mutations:**
     - Reverting the `TooManyRequests` branch should redden (b).
     - Removing the D2a pre-check should redden (c)'s `request_count`-unchanged assertion.
     - Reverting the D2a re-arm to `releaseClaim` should redden (c)'s row-present assertion.
   - **Recording:** record the mutations as actually performed. Do not record 4.2 as written. The evaluator should hold the executor to this.
2. **Neither fixture rule nor test can tell a correct D2a predicate from a wrong one.** The fixture rule sets both `status` and `completed_at`, so a pre-check that wrongly counted `completed_at IS NULL` would still pass case (c). Predicate fidelity therefore rests on task 3.1b's reuse/extract requirement. The evaluator should verify by reading code that `countOwnerInFlightRealRunsInternal` shares `countAndInsertAction`'s query (one source of truth), not a re-typed copy.
3. **The `pipeline-run-guard` wording does not quite match D2a.** That spec's "An auto-run submission is subject to the same guards as a manual one" says each fire is "rejected exactly as a manual API submission would be". Under D2a, a cap-blocked auto-run is withheld before `submit`, so it skips the rate-slot side effect a manual submit at the cap incurs. The outcome is the same (no run) and stricter, never looser, so I do not count this as a spec violation. A one-line note in the PR body, or a clarifying sentence in design.md, would stop a later reviewer flagging it as divergence.
4. **D2a's read context.** `countOwnerInFlightRealRunsInternal` should run under `withSystemContext`, as `hasActiveRunInternal` does. The owner join already scopes it, so the count is the same either way, but it should not be issued under a user context the scheduler does not have.
