## Skeptic Report — final gate (round 3, skeptic-final-1.md)

Reviewed commit `57fbd589ea5cc4152a1409896d8c28158560c48c` (base `78ebb3a6a035dd04503b719b247eb5e60298ff32`,
resolved live via `scripts/concertino/resolve-review-base.sh`). `git diff --stat` matches
`files-modified.md`'s 23-file list exactly; no stray uncommitted changes, no leftover
screenshots at repo root (`git status --porcelain` shows only the evaluator's own untracked
`evaluation-1.md`).

### What I verified (with evidence)

1. **Systematic-debugging compliance / probe genuineness.** Read `SseReconnectGapProbeSpec.scala`
   in full and re-ran it myself fresh: `sbt "testOnly com.helio.api.routes.pipelines.SseReconnectGapProbeSpec"`
   → 2/2 passed. Cross-checked probe 1's claim against `PipelineRunRegistry.scala`'s
   `broadcastLocal` (lines 129-136): on a terminal event it does `subscribers.asScala.foreach(_ !
   ActorStatus.Success(()))` then unconditionally `refs.remove(pipelineId)` — the ENTIRE
   pipeline-id entry is deleted, not just per-subscriber cleanup. This is exactly the structural,
   deterministic (not timing-dependent) gap the probe claims. Probe 2's claim that a second
   `succeeded` row genuinely lands under real guard defaults is real — I ran it myself and the
   assertion (`rows.count(_.status == "succeeded") shouldBe 2`) passed against a real
   `pipelineRunRepo`/`PipelineRunService.submit` with the concurrency cap active. Candidate (e) is
   genuinely falsified; no escalation was warranted, and none was raised. **This part of the work
   is sound.**

2. **AC bullet 2 / cross-instance correctness.** Traced `PipelineRunService.latestRun` (line 795) →
   `pipelineRepo.findByIdShared(pipelineId, Some(user))` (the same ACL call site pattern used at
   line 711 for `run-history` and line 950 for `pipelineExistsShared`) → on success,
   `pipelineRunRepo.latestRunInternal(pipelineId)`, which reads directly from the durable
   `pipeline_runs` table (`PipelineRunRepository.scala:325-332`), independent of
   `PipelineRunRegistry`/`PipelineRunNotifyBus`. This part is genuinely cross-instance-correct as
   claimed (design.md Decision 4) — **but see Change Request 1 below**, which is a defect in
   exactly this read path.

3. **AC bullet 3 / RED-before-GREEN proof.** Read `pipelineRunFanout.test.ts`'s "HEL-1174
   regression" test (lines 409-442) in full: it forces the exact reconnect-gap interleaving (first
   `runs/latest` call returns 404, live SSE delivers run-1's `succeeded`, then the SECOND
   `connect()`'s `runs/latest` call returns `run-2` already `succeeded` with the second mock SSE
   connection never pushing anything for `run-2`) — the test can only pass via the `reconcile()`
   call, not the live channel. I did not need to literally revert-and-rerun this one (the
   evaluator already did and I found no reason to doubt it, and I independently reproduced a
   *different*, real defect below using the same harness/mock pattern, which corroborates that the
   harness genuinely exercises the code path rather than trivially passing). Real proof, not
   fabricated.

4. **Design-gate-mandated corrections.** Verified `PipelineRunLatestRoutes.scala` uses
   `findByIdShared`-style ACL (not `runs/:runId`'s ACL-less lookup) — confirmed via
   `PipelineRunRoutesSpec`'s viewer-grantee-200 / no-grant-404 tests, which I read and re-ran
   (`sbt "testOnly com.helio.api.routes.pipelines.PipelineRunRoutesSpec"` → 52/52 passed, including
   all 6 new `runs/latest` tests). Verified `ApiRoutes.scala:946-947` mounts
   `PipelineRunLatestRoutes` before `PipelineRunStatusRoutes` in the same `concat(...)`, and that
   `PipelineRunRoutesSpec`'s `makeRoutes` test helper (lines 243-252) mirrors that exact order — the
   "is not shadowed by the runs/:runId wildcard route" test proves this at the HTTP level and
   passed. Both design-gate corrections genuinely shipped as claimed.

5. **"First-connect must not fire" deviation — REOPENS THE ORIGINAL CLASS OF GAP. See Change
   Request 1.** I did exactly the check the brief asked for (a run in flight at mount time,
   completing moments after mount) and it is broken. Full reproduction below.

6. **e2e proof.** Started dev servers via `scripts/concertino/start-servers.sh` (reused healthy
   instances) and confirmed `assert-phase.sh servers` → `PASS`. Ran the real, unmodified
   `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` myself against `DEV_PORT=6606`/`BACKEND_PORT=9513`:
   `1 passed (1.1m)`. This class of evidence (the e2e genuinely passes against live infra) is real.
   I did not re-run the full 20x loop — one live pass plus the reproduced code-level defect below
   is sufficient signal; the 20x-loop claim's methodology (3 workers, `nice -n 19`, unmodified
   timeouts) is consistent with this repo's documented practice and not what's in question here.

7. **`files-modified.md` / C5 completeness.** `git diff --stat 78ebb3a6...HEAD` lists exactly the
   23 files `files-modified.md` and `proposal.md`'s Impact section both describe. No stray
   uncommitted changes; no leftover screenshots at repo root.

8. **UI-facing check.** No new UI surface. The one live e2e run above exercises the real
   table-panel refresh behavior end-to-end (not just headless assertions) and it visibly refreshed
   correctly for the tested happy path.

### The reproduced defect (Change Request 1, detailed)

**Root cause of the new gap:** `PipelineRunRepository.latestRunInternal` (line 325-332) has **no
status filter** — it returns whatever `pipeline_runs` row is most recent by `started_at`,
regardless of status. `PipelineRunRepository.insertRunRowAction` (line 75-98) inserts a row with
`status = "queued"` **at the moment a run starts**, before it reaches any terminal status. So `GET
/api/pipelines/:id/runs/latest` can and does return a **non-terminal** (`"queued"`/`"running"`) run
summary whenever a subscriber's reconcile call happens to race an in-flight run.

On the client, `pipelineRunFanout.ts`'s `reconcile()` (lines 110-155) sets
`entry.lastObservedRunId = data.id` **unconditionally at the end, regardless of `data.status`**
(line 154, "Set regardless of status" — this was deliberately written to handle a later
`failed`/`dry_run` run, but it doesn't distinguish "already terminal" from "still in flight").
Combined with the "first-connect must not fire" correction (`isFirstObservation`, lines 136-151),
this produces a silent, permanent notification loss for a specific, realistic sequence:

1. A panel/dashboard mounts (`subscribeToPipelineSucceeded` → first-ever `connect()` for that
   pipeline id) at the exact moment a run (auto-run tick, form-submit debounce, or manual run) is
   already inserted as `"queued"`/`"running"` but not yet terminal.
2. `reconcile()`'s first call sees this in-flight run, correctly does not fire (status isn't
   `"succeeded"`), but **sets `entry.lastObservedRunId` to this run's id anyway** — establishing a
   "already observed" baseline for a run whose outcome has not actually been observed yet.
3. The live SSE stream that `connect()` opens immediately after eventually receives this exact
   run's terminal `"succeeded"` event, carrying the same `runId`.
4. The live-path dedup check (`pipelineRunFanout.ts` line 221-222:
   `parsed.runId === undefined || parsed.runId !== entry.lastObservedRunId`) sees `parsed.runId ===
   entry.lastObservedRunId` → `isNewRun` is `false` → **the listener is never invoked.**

The panel silently never refreshes for the very first run it should have observed — the exact
class of user-facing symptom (`"a form/counter works once and then, intermittently, downstream
charts silently stop refreshing"`) this ticket exists to close, reopened via a different,
untested interleaving.

**I reproduced this empirically**, not just by reading the code. I wrote a temporary test file
(`frontend/src/features/panels/services/__hel1174_skeptic_probe.test.ts`, deleted immediately
after running — `git status --porcelain` confirms no residue) using the executor's own
`createFetchMock` pattern from `pipelineRunFanout.test.ts`:

```
it("SHOULD fire when the run that was in-flight at mount time later succeeds via live SSE", async () => {
  // reconcile's first call sees the run already inserted (status: "queued") — matches
  // insertRunRowAction's real behavior and latestRunInternal's lack of a status filter.
  const { fetchMock, connections } = createFetchMock([{ id: "run-inflight", status: "queued" }]);
  ...
  connections[0].push("run-status", JSON.stringify({ status: "succeeded", rowCount: 1, runId: "run-inflight" }));
  await flush();
  expect(listener).toHaveBeenCalledTimes(1);   // FAILS: received 0
});
```

Result: `Expected number of calls: 1, Received number of calls: 0` — confirmed FAIL against the
real, shipped `pipelineRunFanout.ts`. This is not a hypothetical edge case; it is directly
reachable by an ordinary dashboard page load or panel mount that happens to coincide with any
in-flight pipeline run (a window that exists on every single run, queued+running duration, not
just the reconnect race this ticket targeted). No test in `pipelineRunFanout.test.ts`'s new
"reconcile-on-connect" `describe` block (lines 386-511) covers this interleaving — the closest
test (line 392, "does not fire on the very first connect, even when the pipeline's latest run is
already succeeded") only exercises an already-**terminal** latest run at first connect, not an
in-flight one.

### Verdict: REFUTE

The probe work, the ACL fix, the route-mount-order fix, and the primary reconnect-gap fix
(Decisions 2-4) are all genuinely sound and independently verified above. But the executor's own
additional, beyond-design correction ("first-connect must not fire") introduces a new, reproduced,
silent data-loss defect of the *same class* the ticket is meant to close — on a release explicitly
recorded as blocked on this exact class of bug being fixed, not partially reopened. This cannot
ship as-is.

### Change Requests

1. **Fix the in-flight-run dedup hole (blocking).** `reconcile()` must not adopt a non-terminal
   run as the observed baseline, or the backend read must not surface a non-terminal run at all.
   Two viable directions, either is acceptable, but ONE MUST be picked and proven with a
   regression test that reproduces the exact interleaving above (currently missing from the
   `describe("subscribeToPipelineSucceeded — reconcile-on-connect ...")` block):
   - **(a) Client-side (smaller diff):** in `pipelineRunFanout.ts`'s `reconcile()`, only update
     `entry.lastObservedRunId` when `TERMINAL_STATUSES.has(data.status)` is true (mirrors the exact
     set already used in the live-SSE path). A `"queued"`/`"running"` reconcile result should be a
     no-op entirely — it tells the client nothing has completed yet, so there is nothing to adopt
     as a baseline.
   - **(b) Backend-side:** filter `latestRunInternal`'s query (or `latestRun`'s response) to only
     ever surface a TERMINAL row (`succeeded`/`failed`/`dry_run`), treating a pipeline whose most
     recent run is still in flight the same as "no completed run yet" (404) for reconciliation
     purposes — arguably the more architecturally correct place, since "the pipeline's actual
     latest run OUTCOME" (design.md's own wording) implies a completed result, not an in-progress
     one.
   - Add the regression test: reconcile's first call reports a `"queued"`/`"running"` run, then the
     live SSE stream delivers that SAME run's `"succeeded"` terminal event with the same `runId` —
     assert the listener DOES fire. This is the RED-before/GREEN-after case currently absent.
2. **Re-verify the "does not fire on the very first connect" test (line 392) still holds** after
   whichever fix direction is chosen — it must still pass (a first connect against an
   already-**terminal**, already-succeeded prior run must still establish baseline without firing;
   only the non-terminal case changes).
3. **Non-blocking:** consider whether `docs`/`design.md`/the `pipeline-run-sse` spec delta should
   gain an explicit scenario for "reconcile observes a non-terminal run" now that this case is
   proven reachable — the evaluator's own non-blocking note about the first-connect scenario
   lacking a spec scenario applies doubly here.

### Non-blocking notes

- `tasks.md` task 2.3 says "5 new tests" for `PipelineRunRoutesSpec.scala`; the actual diff added 6
  (matches `files-modified.md`'s correct count). Stale count in tasks.md only, not a defect.
- The evaluator's Phase 2 code review flagged a real, low-severity, non-blocking coverage gap
  (`runId` not asserted through `PipelineRunCrossInstanceSpec.scala`'s NOTIFY/LISTEN round-trip) —
  I did not re-verify this independently since it does not affect my REFUTE, but it is a reasonable
  suggestion to pick up alongside Change Request 1.
