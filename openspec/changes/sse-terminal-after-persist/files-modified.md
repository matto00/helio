- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — new `publishTerminalAfter`; every terminal publish (`onUnblockedRunSuccess`, `executeRunFailure`, `onWriteBackFailure`, `onBlockedRun`, `onDryRunSuccess`) now fires after that path's own write chain completes (success or failure), exactly once
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceTerminalOrderingSpec.scala` — new lock-holding ordering spec (succeeded with staged release, failed x3, dry_run)
- `e2e/support/auth.ts` — add `currentUserId(request)` helper
- local `registerThenLogin` replaced: local `registerThenLogin` replaced by `registerUser` -> `currentUserId` -> (hel1277: tier) -> `loginThenIsolate` at the call site; email shape (`prefix` carries the label so displayName stays "HEL-NNNN"), logs, tier order and isolate preserved; hel1277 diff is the helper swap only (+ dropped unused `Page` import)
- `e2e/hel1277-output-history-scrubber.spec.ts`
- `e2e/hel1350-chart-compare-picker.spec.ts`
- `e2e/hel1351-aggregated-chart-overlay.spec.ts`
- local `uniqueEmail` replaced by the shared one (prefix hel287/hel665/hel666/hel716/hel908/hel912/hel958-join, `example.com`), same email shapes, in:
- `e2e/auth-cookie-migration.spec.ts`
- `e2e/hel665-message-composer.spec.ts`
- `e2e/hel666-single-assistant-entry.spec.ts`
- `e2e/hel716-panel-detail-tall-viewport-footer.spec.ts`
- `e2e/hel908-full-flow.spec.ts`
- `e2e/hel908-step-card-split.spec.ts`
- `e2e/hel908-tail-attach.spec.ts`
- `e2e/hel908-trunk-reorder-drag.spec.ts`
- `e2e/hel908-trunk-reorder-order.spec.ts`
- `e2e/hel912-lanes-rejoin.spec.ts`
- `e2e/hel958-join-step-editor.spec.ts`
- `openspec/changes/sse-terminal-after-persist/*` — tasks ticked; evidence logs below

## D3 consumer enumeration (registry.publish / PipelineRunNotifyBus)
Grep over `backend/src/main`: `registry.publish` is called only inside `PipelineRunService.publish` (queued / running / node-progress / the five terminal sites). The only reader is `PipelineRunStreamRoutes` (`runService.eventRegistry.subscribe` -> SSE bytes to HTTP clients). `PipelineRunNotifyBus` is constructed in `Main`/`ApiRoutes` and consumed solely by `PipelineRunRegistry` (`onReceive` -> `broadcastLocal`, `notifyRemote` on publish). No in-process consumer writes to the DB or otherwise depends on the terminal event preceding the writes. Remote instances receive the event via NOTIFY, now also after the writes. `eventRegistry` has no other caller. Conclusion: none needs terminal-before-persist.

## D1 escape hatch
Not used. The whole existing chain (including alert evaluation, `AlertEvaluationService` — DB-only, no network call — and the baseline upsert) is awaited before publishing.

## D2 single-terminal check (by reading the code)
Each path publishes via exactly one `publishTerminalAfter` call. `executeRun`'s `runFuture.transformWith` routes `Failure` to `executeRunFailure` and `Success` to `executeRunSuccess`; a later failure inside `executeRunSuccess` (write-back / success writes) returns a failed Future out of `executeRun` and is NOT re-routed into `executeRunFailure`, so no path publishes twice. Spec asserts one terminal event per run; caveat: the registry removes a subscriber once its terminal event arrives, so a hypothetical second terminal publish would not reach that subscriber, and the spec's count is therefore backed by this code reading as well.

## Accepted edge (design Risks)
`onUnblockedRunSuccess`'s `for` fails fast: if `materializedWrites` fails, `succeeded` can be published while the eagerly started `updateRun` is still in flight. Write-failure path only; durability is not claimed on that path.

## Evidence (in this directory)
- `red-prefix-run.log` — new spec against UNMODIFIED `PipelineRunService`: 5/5 FAILED with "terminal event received while write blocked (...)" (the non-vacuity `pg_blocking_pids` checks passed first in every case, so the locks were really blocking a service backend).
- `green-run.log` — same spec after the fix: 5/5 pass.
- `testFull-summary.log` — `sbt testFull`: 6090 succeeded, 0 failed (full log in `.concertino/runs/HEL-1366/testFull.log`, 7 MB).
- `hel1094-repeat.log` — hel1094 `--repeat-each=4 --workers=2` under `nice -n 19`: 4 passed (regression evidence, not proof; waits untouched).
- `touched-specs.log` — touched e2e specs, workers=3: 20 passed. Five touched specs are quarantined by `playwright.config.ts` testIgnore (hel665, hel666, hel716, hel908-tail-attach, hel912) so they did not run; they were checked by `tsc -p e2e/tsconfig.json`, `npm run lint` and prettier.

## Cycle 2 (evaluation-1.md change requests)
- CR1: the spec now builds the service's registry on a real `PipelineRunNotifyBus` (embedded Postgres) and counts terminal events per pipeline at the publish level on a second, independent witness bus (no subscriber removal), after a bounded 1.5 s settle window (`assertExactlyOneTerminalPublished`). Replaces reliance on the registry subscriber's size check.
- CR2: two new cases install a test-only BEFORE UPDATE trigger on `pipeline_runs` (raises for that pipeline's terminal status, dropped afterwards) and assert exactly one `failed` (execution exception) / `succeeded` event is still published and submit completes.
- CR3: `red-mutant-run.log` — spec against the evaluator's mutant (`flatMap` + double publish in `publishTerminalAfter`) in a throwaway worktree (removed by exact path): 7/7 FAILED, including the CR1 double-publish counts ("published terminal events: Vector(succeeded, succeeded)") and both CR2 cases. `green-run.log`: 7/7 pass on the real code. Persisted via persist-evidence.sh.
- Non-blocking: `publishTerminalAfter` now takes the write chain by-name and starts it inside `Future.unit.flatMap`; each of the five sites builds its chain in a local def, so a synchronous throw becomes a failed Future and still publishes.
- `sbt testFull` cycle 2: 6092 succeeded, 0 failed (`testFull-summary.log`).
- PR description note: `PipelineRunService.scala` is now ~1751 lines (was 1723; budget ~250 soft / ~400 split threshold). Proposed split: extract the five terminal-path methods plus `publishTerminalAfter` / `persistAssertions` into a `PipelineRunTerminalWrites` collaborator, and `executeRun*` orchestration into a `PipelineRunExecutor`, as a separate behaviour-preserving ticket.

## Cycle 3 (evaluation-2.md)
- Spec hardening only (`PipelineRunServiceTerminalOrderingSpec.scala`): every `Held` lock is registered and released in `afterEach` (idempotent `release()`), so a failing assertion never leaves a lock held; `withFailingTerminalUpdate` sets `lock_timeout = '5s'` on the DDL connection and does CREATE FUNCTION/TRIGGER inside the `try` with a nested-finally DROP of both.
- Base run (`red-prefix-run.log`): spec vs the pre-fix `PipelineRunService.scala` COMPLETES in 7 s (no hang): the 5 ordering cases FAIL at the ordering assertion; the 2 failing-write cases pass on base (publish-first still publishes once on write failure), which is expected - they guard publish-on-failure, not ordering.
- Mutant run (`red-mutant-run.log`): 7/7 FAILED. Real code (`green-run.log`): 7/7 pass. Throwaway worktrees removed by exact path.
- Only the spec changed this cycle; `sbt testFull` from cycle 2 (6092/0) covers the unchanged main code, and the spec itself was re-run 3 ways above.
