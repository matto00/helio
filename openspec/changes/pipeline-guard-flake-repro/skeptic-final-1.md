## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Diff scope, fresh, live-resolved base.** `resolve-review-base.sh` returned
   `c740775e7b73c51b248619e39967fa710f4c8d4e` (exit 0). `git diff <base>...HEAD --stat`
   shows exactly one source file touched:
   `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
   (+39/-8), plus this change's own `openspec/changes/pipeline-guard-flake-repro/**`
   artifacts. `git diff <base>...HEAD --stat -- 'backend/src/main/**'` returned nothing —
   confirmed no production code touched, not merely trusted from `files-modified.md`.

2. **Read the actual diff.** All six rate-limit tests' `PipelineRunGuardConfig(...,
   rateWindowSeconds = 60, ...)` changed to `3600`; no assertion shape changed. A new
   `withClue(s"admitted=..., rejected=...")` wraps the concurrency-cap test's two final
   assertions (`admitted shouldBe maxConcurrent`, `rejections should have size ...`) —
   strictness unchanged, only diagnosability added. A substantive doc comment above the
   rate-limit `describe` block explains the mechanism. This matches `files-modified.md`'s
   claims exactly.

3. **Independently re-derived the H1/H2/H3 classification from the raw surefire XML**
   (`repro-evidence/1/TEST-...xml`), not from the executor's or evaluator's prose:
   - 10 testcases recorded; exactly 1 failure, in `... rate limit ... should rejects the
     (limit+1)th submission within a window with TooManyRequests ...`, `time="0.471"`.
   - All 4 concurrency-cap testcases in the same run show empty (passing) `<testcase>`
     bodies — rules out H1 (`4 != 3` guard-admission mismatch never appears; the
     concurrency-cap test itself passed in this exact run).
   - The failure text is `expected Left(TooManyRequests), got Right(RunResultResponse(...))`
     at `PipelineRunGuardIntegrationSpec.scala:188` inside `tooManyRequests(...)` — no latch,
     `awaitAllSettled`, or settlement text anywhere — rules out H2.
   - This is squarely H3 (a rate-limit test, not the concurrency-cap/settlement path).
   My own reading of the XML independently confirms both the executor's and the
   evaluator's classification; C4 (H1 → stop-and-escalate, never self-approved past) is
   correctly not triggered.

4. **Read the actual production code the fix's reasoning depends on**, not just trusted
   the write-up:
   - `PipelineRunGuardRepository.bucketStart`/`incrementRateIfUnderLimit`
     (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunGuardRepository.scala:29-63`):
     confirmed absolute wall-clock-anchored fixed-window bucketing
     (`(epochSeconds / windowSeconds) * windowSeconds`), and confirmed the method DOES
     already have an overridable `now: Instant = Instant.now()` default parameter — a
     seam exists at the repository layer.
   - `PipelineRunService.executeRun` line 997: `grep` + direct read confirms
     `incrementRateIfUnderLimit(user.id, guardConfig.rateLimitPerWindow,
     guardConfig.rateWindowSeconds)` — no `now` argument passed, and `submit()`'s public
     signature (line 216) has no clock/now parameter either. So the repository-level seam
     is never exposed up through the service's public API that an integration test (which
     only has `service.submit(...)` to call) could use. Confirmed independently — this is
     not merely asserted by the evaluator, I read both call sites myself.

5. **Reproduced the mechanism-proving unit test myself, fresh** (not trusting the
   evaluator's paste):
   ```
   cd backend && nice -n 19 sbt -batch 'testOnly com.helio.infrastructure.persistence.pipelines.PipelineRunGuardRepositorySpec -- -z "buckets by window"'
   ...
   [info] - should buckets by window: a submission in a NEW window bucket does not count toward the prior bucket's cap
   [info] Tests: succeeded 1, failed 0, canceled 0, ignored 0, pending 0
   [info] All tests passed.
   ```
   This is the same deterministic, `Instant`-driven proof of the exact mechanism the
   fix's reasoning rests on.

6. **Re-ran `PipelineRunGuardIntegrationSpec` myself, fresh, in isolation**:
   ```
   cd backend && nice -n 19 sbt -batch 'testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec'
   ...
   [info] Total number of tests run: 10
   [info] Tests: succeeded 10, failed 0, canceled 0, ignored 0, pending 0
   [info] All tests passed.
   ```
   Matches the executor's/evaluator's claim (10/10).

7. **Gates**: `node scripts/check-scala-quality.mjs` — clean, 188 pre-existing soft
   warnings (same count the evaluator reported; none newly introduced by this diff).
   `npm run check:openspec` — clean. I relied on the evaluator's pasted `sbt test`
   full-suite output (`Total number of tests run: 4883`, `succeeded 4883, failed 0`) as
   sufficient fresh evidence for the full-suite regression claim — it is a concrete,
   specific pasted result (not a bare assertion), and I independently reproduced the two
   most load-bearing sub-results (the affected spec in isolation, and the mechanism-proof
   unit test) myself above, so I am not resting the full-suite claim on trust alone.

8. **UI review**: N/A. No `frontend/**` changes; confirmed by the diff stat in (1).

### Required ruling — statistical mitigation vs. deterministic fix (independent)

Ruling: **(b) — the 3600s statistical mitigation is acceptable as implemented**, CONFIRM
conditioned on the standalone follow-up ticket being filed before delivery.

Reasoning, derived from my own reading above, not the evaluator's prose:

1. A deterministic fix is a real production-code change. I confirmed myself (step 4)
   that `PipelineRunService.submit`/`executeRun` has no clock-injection seam reaching
   `incrementRateIfUnderLimit`'s existing `now` default parameter — building one means
   threading an explicit `now`/`Clock` argument through `submit()`'s public signature,
   which is unambiguously a change to `backend/src/main/scala/.../PipelineRunService.scala`.
   That is squarely inside this ticket's own Non-Goals ("Any production-code change
   UNLESS hypothesis 1 is probe-confirmed, and only after an explicit escalation").
   H1 was not confirmed — I independently re-derived that in step 3, not just trusted it.
   Requiring the deterministic fix inside this ticket right now would mean self-approving
   past that boundary, which is exactly what C4 and the Non-Goals exist to prevent. I am
   not going to require it; the tension is real but is resolved by NOT taking the
   deterministic path here, not by escalating a decision I'm not actually forced to make.
2. The 60→3600 change is mechanism-tied, not a round-number guess. It is tied to a
   probe I reproduced myself (step 5), and the two-parameter reasoning (elapsed time
   between sequential submissions ÷ window size) is linear and directly falsifiable if
   the window value or the mechanism were wrong — it isn't a "raise it and hope" move,
   and no assertion strictness changed anywhere in the diff (confirmed in step 2).
3. A bare pass count is explicitly NOT what I am resting this ruling on. The 4883/4883
   and 10/10 numbers I cite above are gate evidence, not the justification — the
   justification is the mechanism confirmation in steps 3-5.
4. Residual risk is real (the race is ~60x rarer, not eliminated) and is disclosed
   plainly in `repro-findings.md` and `workflow-state.md`, not hidden — and the repo
   already has a documented low-cost triage convention for exactly this residual shape
   (`CONTRIBUTING.md`'s HEL-924 "unreproduced-on-immediate-rerun = environmental" note).

**Blocking pre-delivery gap I am flagging, independent of the evaluator's identical
note**: as of this review, the required follow-up Linear ticket (deterministic
clock-injection seam, `Follow-up` label, `origin_kind: followup` /
`origin_ticket: HEL-1195`, `relatedTo`) has **not been filed**. I checked `HEL-1195`'s
own Linear relations directly (`get_issue` with `includeRelations: true`) — its
`relatedTo` list contains only `HEL-505`, `HEL-1188`, `HEL-1184`; no follow-up ticket
for this deterministic-fix question exists yet anywhere in that list.
`workflow-state.md`'s own resume-step 6 ("File the standing follow-up before
cleanup.sh... if the evaluator/skeptic surface one") is now triggered by both the
evaluator's and my own explicit surfacing of this requirement. This is not a defect in
the diff and not grounds for REFUTE on its own — it is the explicit condition this
CONFIRM is issued under, per the driver's own framing — but it is a hard blocking
precondition for delivery: **the orchestrator must file that follow-up ticket, with the
metadata above, before running `cleanup.sh`,** exactly as the ticket's own standing
brief requires for every follow-up.

### Verdict: CONFIRM

Conditioned on: the standalone follow-up Linear ticket for the deterministic
clock-injection fix (production-code seam in `PipelineRunService`) being filed — with
`Follow-up` label, `origin_kind: followup` / `origin_ticket: HEL-1195`, and `relatedTo`
back to HEL-1195 — before `cleanup.sh` runs / before this ticket is considered
delivered. As of this report, that ticket does not yet exist (verified via
`get_issue(HEL-1195, includeRelations=true)`).

### Non-blocking notes

- `tasks.md` 4.4's own prescribed Verify step (mutate to force a mismatch, confirm the
  `withClue` text appears, then revert) has no evidence trail in `repro-findings.md`/
  `files-modified.md`, same gap the evaluator already noted. The `withClue` wrap itself
  is correctly shaped and low-risk (`withClue`'s message-prepending is a guaranteed
  ScalaTest library contract), so I am not treating this as a Change Request, but a
  future cycle should either cite the missing evidence or not mark the task `[x]`.
- No gate-defect finding to record here: I did not find any report in this chain
  presenting an mtime-ordering claim as self-evidently reliable — the evidence I relied
  on (XML content, diff content, fresh command output) is all self-authenticating, not
  positional/temporal.
