## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed commit `80f40f97b051505c24c45a94fbfa7fb0460b305a` (base
`78ebb3a6a035dd04503b719b247eb5e60298ff32`, resolved live via
`scripts/concertino/resolve-review-base.sh`). `git status --porcelain` at HEAD shows only the
pre-existing untracked `evaluation-1.md`/`skeptic-final-1.md` reports — no stray changes.

I am cold to this run; every claim below is evidence I gathered myself against the live worktree,
not carried over from the executor's or round-1 skeptic's narrative.

### What I verified (with evidence)

1. **The CR1 fix is real and complete.** Read the current `reconcile()` in
   `frontend/src/features/panels/services/pipelineRunFanout.ts` (lines 110-169) in full. Line 147
   (`if (!data.status || !TERMINAL_STATUSES.has(data.status)) return;`) sits directly after the
   `data.id === entry.lastObservedRunId` short-circuit (line 133) and strictly before the only
   remaining write to `entry.lastObservedRunId` in this function (line 168) — a non-terminal
   (`"queued"`/`"running"`) or missing-status result now returns before that write is ever reached.
   `grep -n "lastObservedRunId"` on the file shows exactly three write sites: the initial
   `undefined` at entry creation (line 60, unrelated), `reconcile()`'s line 168 (now correctly
   guarded), and the live-SSE-path write at line 240 (only reached inside the terminal-status
   branch of the read loop, so it was never at risk). No second, unguarded write site exists.

2. **Reproduced RED before the fix, then GREEN after, myself — did not just trust the executor's
   pasted transcript.** Backed up the file, commented out line 147's guard, ran
   `npx jest --testPathPatterns=pipelineRunFanout`: exactly 1 failure — "fires when a run that was
   in-flight (queued) at mount time later succeeds via the live SSE path, with the SAME run id" —
   `Expected number of calls: 1, Received number of calls: 0`, 15/16 otherwise green (i.e. the
   guard's removal breaks only the targeted case, nothing else). Restored the file from my backup,
   confirmed `git diff --stat` on the file showed nothing (byte-identical restore), re-ran: 16/16
   green.

3. **The new regression test genuinely forces the claimed interleaving.** Read the added test
   (`pipelineRunFanout.test.ts` lines ~409-441): `createFetchMock` returns `{id: "run-inflight",
   status: "queued"}` on the first (and only) `/runs/latest` call, asserts the listener has NOT
   fired after that reconcile call, then pushes a live SSE `run-status` event with
   `{status: "succeeded", runId: "run-inflight"}` — the SAME run id — and asserts the listener fires
   exactly once. This can only pass if reconcile leaves `lastObservedRunId` unset for the in-flight
   observation, letting the live path's own dedup check treat the terminal event as new. Confirmed
   this is real by the RED/GREEN reproduction above, not by reading alone.

4. **Round-1's originally-CONFIRMed concerns re-verified, nothing regressed:**
   - "does not fire on the very first connect when latest run already succeeded" — part of the same
     16-test suite I ran fresh; passed.
   - `SseReconnectGapProbeSpec` — re-ran fresh: `sbt "testOnly
     com.helio.api.routes.pipelines.SseReconnectGapProbeSpec"` → 2/2 passed.
   - `PipelineRunRoutesSpec` (ACL + route-mount-order, 52 tests incl. the 6 `runs/latest` tests) —
     ran alongside the probe spec in the same `testOnly` invocation → 54/54 passed. Independently
     re-read `ApiRoutes.scala:940-949`: `PipelineRunLatestRoutes` is still mounted before
     `PipelineRunStatusRoutes` in the same `concat(...)` (unchanged by cycle 2, which touched no
     backend file at all — confirmed by `git show 80f40f97 --stat`, only 2 source files plus
     `files-modified.md`/`tasks.md` changed).
   - `PipelineRunLatestRoutes.scala`/`PipelineRunService.latestRun` read straight from the durable
     `pipeline_runs` table via `pipelineRunRepo.latestRunInternal`, independent of any in-memory
     registry — cross-instance-safe by construction (unchanged, and this is exactly the code path
     round 1's defect lived downstream of on the client, not here).
   - Fresh e2e: started servers via `start-servers.sh`/`assert-phase.sh` (`PASS`), ran
     `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` with `DEV_PORT=6606 BACKEND_PORT=9513` (per
     CON-165, never bare `npx playwright`): `1 passed (55.5s)`.

5. **Adversarial interleavings beyond the one round 1 specified — traced by hand against the
   current code, no further defect found:**
   - **In-flight run later FAILS (not succeeds), does a later run for the same pipeline still
     fire?** Trace: `reconcile()` no-ops while `R1` is `"queued"` (per the fix,
     `lastObservedRunId` stays unset). If `R1`'s terminal event is `"failed"`, the live-SSE branch
     (line 229-243) still treats it as terminal — `isNewRun` is true (`lastObservedRunId` was
     unset), but since `status !== "succeeded"` no listener fires (correct — a failed run isn't a
     "succeeded" notification), and `entry.lastObservedRunId` is set to `R1` at line 240 (an
     absolute run id, not "the last succeeded run"). A later, DIFFERENT run `R2` for the same
     pipeline has a different id, so `R2 !== entry.lastObservedRunId (R1)` is true regardless of
     whether `R1` failed or succeeded — `R2`'s own eventual `"succeeded"` event fires normally.
     Confirmed by reading the dedup condition at line 236, which compares by id, never by "has a
     succeeded run already fired" — no bug here.
   - **Two reconnects while the same run is still in-flight, both times.** Traced the call graph:
     `connect()` is invoked from exactly three places — the initial `subscribeToPipelineSucceeded`
     (guarded by `if (!entry)`, so only once per entry lifetime), the D3 post-terminal immediate
     reconnect (called only after the prior `connect()`'s fetch/read-loop has already returned), and
     `scheduleRetry`'s `setTimeout` callback (fires only after the prior `connect()` invocation has
     already returned via one of its early-return/backoff paths). There is no code path under which
     two `connect()` (and therefore two `reconcile()`) calls for the same `entry` are in flight
     concurrently — invocations are strictly sequential within one pipeline's fan-out entry. Even if
     they were concurrent, the guard is idempotent: repeated no-ops on a still-`"queued"` result
     never touch `lastObservedRunId`, so no interleaving of repeated reconciles against the same
     in-flight run can corrupt the baseline.
   - **A fourth variant: rapid full unsubscribe-then-resubscribe while a run is in-flight.**
     `closeEntry` deletes the module-scope `entries` map entry and aborts its controller;
     `subscribeToPipelineSucceeded`'s next call (if `!entries.get(pipelineId)`) allocates a brand
     new `FanoutEntry` with `lastObservedRunId: undefined` and calls `connect()` fresh — the old
     entry's in-flight `reconcile()` fetch is aborted (caught by the generic `catch { return; }`) and
     never touches the new entry's state (separate object). This resets the baseline entirely on
     every listener-count-to-zero transition, which is pre-existing behavior unrelated to cycle 2's
     fix (the guard doesn't change this), and does not reopen the specific dedup hole under review —
     flagging only as a pre-existing design property, not a new regression.
   - Considered a `data.status` that is a terminal string other than the three in `TERMINAL_STATUSES`
     (e.g. a hypothetical new backend status) — `!TERMINAL_STATUSES.has(data.status)` fails safe
     (treats unknown as non-terminal, never adopts it as a baseline), consistent with the live-SSE
     path's own set. No divergence between the two `TERMINAL_STATUSES` usages (same module-level
     `const`, not two separately-defined sets).

6. **Full gate re-run, fresh, this round:**
   - `npx jest --testPathPatterns=pipelineRunFanout` → 16/16 (isolated), and full `npm test` (root +
     frontend) → **3712/3712 frontend tests**, 0 failed — matches the executor's claim exactly.
   - `npm run lint` → clean (zero warnings).
   - `npm run typecheck` → clean.
   - `npm run format:check` → clean.
   - Full `sbt test` (backend), run to completion in the background and read to exit: **4831/4831**,
     0 failed, "All tests passed." — matches the executor's claim exactly.
   - Fresh e2e run (`hel1094-sse-fan-out-panel-refresh.spec.ts`, single run): 1 passed (55.5s).

7. **`files-modified.md` completeness for cycle 2.** `git show 80f40f97 --stat` touches exactly 4
   files: `pipelineRunFanout.test.ts`, `pipelineRunFanout.ts`, `files-modified.md`, `tasks.md`. The
   "Cycle 2" section added to `files-modified.md` documents the defect, both fix directions
   considered (with a reasoned choice of (a) over (b)), the regression test, RED/GREEN evidence, and
   the full fresh gate re-run — all of which I independently re-derived above rather than trusting.
   `tasks.md`'s task 3.1 entry was correctly updated with a "Cycle 2" addendum pointing back to
   `files-modified.md`. Nothing from cycle 2's actual code diff is undocumented.

8. **Gate-chain / process observation (not a defect in the shipped code, but worth recording).**
   `evaluation-1.md` (the only evaluator report in this change dir) reviews commit `57fbd589` — the
   PRE-fix commit — and was written before cycle 2's `80f40f97` fix existed; there is no
   `evaluation-2.md` re-reviewing the CR1 fix commit. I did not rely on `evaluation-1.md`'s claims
   for anything in this report (all evidence above is freshly reproduced against `80f40f97`
   HEAD), so this does not change my verdict, but it means the evaluator's mechanical PASS on file
   for this change was never re-run against the commit actually being shipped. Flagging so the
   record is accurate — the skeptic layer, not the evaluator layer, is what actually re-verified
   cycle 2's commit end-to-end.

### Verdict: CONFIRM

The CR1 fix is real, minimal, and correctly scoped: `reconcile()` is now a true no-op on a
non-terminal result, with no other write site to `lastObservedRunId` left unguarded. The regression
test forces exactly the interleaving round 1 reproduced, and I independently confirmed RED-before/
GREEN-after myself rather than trusting the transcript. Round 1's originally-sound findings (probe,
ACL, route-mount-order, cross-instance correctness, the "first-connect must not fire" isolation) are
unaffected and still hold under fresh re-verification. I traced three further adversarial
interleavings beyond the one round 1 specified (failed-then-succeeded run, concurrent/rapid
reconnects, unsubscribe/resubscribe reset) and found no further gap. All gates — frontend suite
(3712/3712), backend suite (4831/4831), lint, typecheck, format, and a fresh e2e run — are green,
independently reproduced by me on the exact commit (`80f40f97`) being reviewed. I would stake the
v0.8.4 release on this.

### Non-blocking notes

- Same as skeptic-final-1.md's Change Request 3 (still open, still genuinely non-blocking): the
  `pipeline-run-sse` spec delta has no explicit scenario for "reconcile observes a non-terminal
  run." Worth a follow-up, not a release blocker.
- Process gap noted in item 8 above: get `evaluation-2.md` (or equivalent) written against the
  actual shipped commit in future cycles, even when a fix is scoped tightly to a single skeptic
  Change Request, so the evaluator's PASS-on-file always matches HEAD.
