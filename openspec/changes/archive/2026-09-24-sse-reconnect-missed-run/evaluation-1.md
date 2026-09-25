## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `57fbd589ea5cc4152a1409896d8c28158560c48c` (base `78ebb3a6a035dd04503b719b247eb5e60298ff32`, resolved live via `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS

- **AC1 (root cause confirmed by probe):** Genuine. `SseReconnectGapProbeSpec.scala` exists at the
  claimed path and does what `probe-evidence.md`/`files-modified.md` claim. I read the test file in
  full: probe 1 subscribes, publishes a terminal event (confirms `registry.subscriberCountForTest`
  drops to 0 via `PipelineRunRegistry`'s own terminal-cleanup branch — verified by reading
  `PipelineRunRegistry.scala`'s `broadcastLocal`, which does exactly `refs.remove(pipelineId)` on a
  terminal status), publishes a second terminal event while zero subscribers are registered, then
  resubscribes and asserts a `TimeoutException`. Probe 2 submits two real runs back-to-back through
  `PipelineRunService.submit` under real guard defaults and asserts both land as `succeeded` rows,
  falsifying candidate (e). I independently ran both tests fresh (`sbt "testOnly
  com.helio.api.routes.pipelines.SseReconnectGapProbeSpec"` — 2/2 passed) and confirmed the
  underlying registry mechanism cited is real, not fabricated. The verdict recorded (structural
  reconnect gap, not a guard rejection) is a fair, well-supported reading of the evidence — no
  escalation was warranted and none was raised.
- **AC2 (subscriber crossing a reconnect never misses a terminal outcome, holds across instances):**
  Implemented correctly. `GET /api/pipelines/:id/runs/latest` reads through the durable
  `pipeline_runs` table (`PipelineRunRepository.latestRunInternal`), which is inherently
  cross-instance-correct (design.md Decision 4) independent of `PipelineRunNotifyBus`/self-echo
  timing — the primary correctness guarantee does not depend on the wire `runId` addition at all.
  `pipelineRunFanout.ts`'s `connect()` calls `reconcile()` before every SSE open (initial subscribe,
  D3 reconnect, and post-backoff retry alike), matching design.md Decision 3.
- **Design-gate-mandated fix 1 (ACL parity):** Verified. `PipelineRunService.latestRun` uses
  `pipelineRepo.findByIdShared(pipelineId, Some(user))` — the same ACL pattern as `run-events`/
  `run-history`, not `runs/:runId`'s ACL-less `status(runId)` lookup. `PipelineRunRoutesSpec` has a
  viewer-grantee 200 test and a no-grant 404 test (existence not leaked), both of which I read and
  which match `run-history`'s existing access semantics.
- **Design-gate-mandated fix 2 (route-matching precedence):** Verified. `ApiRoutes.scala` mounts
  `PipelineRunLatestRoutes` immediately before `PipelineRunStatusRoutes` in the same `concat(...)`,
  with a hazard-comment matching CONTRIBUTING's "hazard" comment guidance. `PipelineRunRoutesSpec`'s
  "is not shadowed by the runs/:runId wildcard route" test proves this at the HTTP-request level
  (not just a compile check) — I ran it and confirmed 200 with the correct run id, not the
  `"Run not found: latest"` 404 that would result from the reversed mount order.
- **Claimed deviation from design.md (first-ever-connect no-fire):** Correct and properly
  distinguished from the real-reconnect case. I read `pipelineRunFanout.ts`'s `reconcile()` and its
  test suite: the "HEL-1174 regression" test proves a genuinely-missed run during a REAL reconnect
  (baseline already established from a live SSE event) still fires via reconcile; a separate test
  proves the very first connect (baseline `undefined`) does NOT fire even when the latest run is
  already `succeeded`. These are two different, correctly-isolated code paths (`isFirstObservation`
  gates only the "already-existing-at-mount" case, not the reconnect-gap case the ticket's AC
  targets), and the AC's actual concern (a subscriber crossing a reconnect) is not reopened by this
  correction.
- **`runId` on the wire, threaded consistently:** Backend `RunStatusEvent`, `toSseBytes`,
  `PipelineRunNotifyBus.encodePayload`/`decodePayload`, and all 8 `publish(...)` call sites in
  `PipelineRunService` all carry `runId` — confirmed by reading each site. Frontend
  `pipelineRunFanout.ts`'s live-event parse path and `usePipelineRunEvents.ts`'s `RunStatusEventData`
  both have the field (the latter unused by design, confirmed the hook never reconnects after a
  terminal event and its single caller has a separate, already-mitigated HEL-972 CR1 gap — verified
  this citation is real).
- **`files-modified.md` completeness (C5):** Matches `git diff --stat` exactly — every one of the 23
  changed files is listed.
- Planning artifacts (design.md, tasks.md, spec.md delta) reflect the implemented behavior. No scope
  creep — every touched file is directly relevant to the reconnect-gap fix.
- No regression to existing behavior: full backend + frontend suites green (see Phase 2).
- `workflow-state.md` CONSTRAINTS (C1-C10) all honored: single commit, `files-modified.md` complete,
  no migration added (V111 still free), no `git add -A`, "owner ruling" used only for the actually-
  recorded release-blocker ruling.

Minor, non-blocking observations (not change requests):
- `tasks.md` task 2.3 says "5 new tests" in `PipelineRunRoutesSpec.scala"; the actual diff added 6
  (never-run 404, unknown-pipeline 404, 200-with-correct-summary, viewer-grantee 200, no-grant 404,
  mount-order regression). `files-modified.md` correctly says 6. Stale count in tasks.md only.
- The `pipeline-run-sse` spec delta's requirement text says a terminal outcome "or before any
  subscriber ever connects" must "never be permanently lost," but doesn't add a scenario documenting
  the first-connect-establishes-baseline-without-firing behavior discovered during Execution. The
  implementation is defensible (the panel's own initial fetch already reflects current state), but
  the spec delta would be clearer with an explicit scenario for this case.

### Phase 2: Code Review — PASS

Gates re-run fresh by me, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` this cycle):

- `npm run lint` — clean (zero warnings).
- `npm run format:check` — clean.
- `npm run typecheck` — clean.
- `npm run check:scala-quality` — clean (0 inline-FQN violations; only pre-existing soft-budget
  warnings on files this diff didn't introduce).
- `npm run check:openspec`, `check:schemas`, `check:spec-structure` — all clean.
- `npm test` (root + frontend Jest) — 271 + 3711 = 3982 passed, matches the executor's claimed
  numbers exactly.
- `npm --prefix frontend run build` — succeeds (same pre-existing chunk-size warning, unrelated).
- `sbt test` (full backend suite) — 4831/4831 passed in 5m56s, matches the executor's claimed numbers
  exactly.
- `sbt "testOnly ...SseReconnectGapProbeSpec ...PipelineRunRoutesSpec"` — 54/54 passed.

Code-quality checklist:
- **Canonical compliance:** No inline FQNs (mechanically verified via `check:scala-quality`). New
  files carry hazard/contract/why comments per CONTRIBUTING's comment standard (e.g.
  `PipelineRunLatestRoutes.scala`'s mount-order doc comment, `PipelineRunRepository.scala`'s
  `latestRunInternal` doc comment).
- **DRY:** `LatestRunResponse` is deliberately its own small type rather than reusing
  `PipelineRunRecord` (which would trigger `history`'s assertion-row joins on every reconnect) —
  a reasoned, documented choice, not duplication for its own sake.
- **Type safety:** No untyped escape hatches introduced.
- **Security:** ACL correction (design-gate round 1) is properly implemented and tested — closes a
  real cross-tenant read that a naive copy of `runs/:runId` would have introduced.
- **Error handling:** `reconcile()` in `pipelineRunFanout.ts` swallows network/parse errors as a
  documented no-op fallback (the live SSE path remains authoritative) — appropriate for a
  best-effort supplementary path.
- **Tests meaningful:** The RED-before/GREEN-after claim for `pipelineRunFanout.test.ts`'s "HEL-1174
  regression" test is credible on inspection — the test's second mock SSE connection never pushes an
  event for `run-2`, so the test can only pass via the `reconcile()` call, not the live channel. I
  did not literally revert-and-rerun this myself (would require a temporary code edit, which this
  role's guardrails forbid), but the code path is unambiguous from reading `connect()`'s unconditional
  `await reconcile(...)` before the SSE fetch.
- **One real, low-severity test-coverage gap (non-blocking):** No test exercises `RunStatusEvent`'s
  new `runId` field through the actual cross-instance NOTIFY/LISTEN path
  (`PipelineRunNotifyBus.encodePayload`/`decodePayload` via `PipelineRunCrossInstanceSpec.scala`,
  which I read in full — none of its `RunStatusEvent(...)` constructions pass `runId`, and no
  assertion reads `events.head.runId`). The encode/decode code itself is correct and follows the
  exact pattern already proven for `errorLog` in the same file. Because design.md Decision 4 makes
  the primary reconciliation fix (the actual thing "must hold across two instances") independent of
  this field — its only failure mode if broken would be a harmless redundant refire on the next
  reconnect, explicitly anticipated in design.md Decision 3 — this is a suggestion, not a blocking
  defect. Recommend one added assertion in `PipelineRunCrossInstanceSpec.scala`'s existing
  cross-instance delivery test asserting `events.head.runId` round-trips.
- **No dead code / TODOs** introduced (grepped the diff).
- **File-size budget:** `pipelineRunFanout.ts` is now 259 lines (soft budget ~250) — trivial overage,
  not worth a split.

### Phase 3: UI Review — PASS

Triggers matched (`frontend/**`, `backend/.../ApiRoutes.scala`). No new visual UI surface was added
(the change is a service/hook-layer fix plus a new backend route) — checklist applied narrowly:

- Started dev servers via `scripts/concertino/start-servers.sh` (reused already-healthy instances)
  and `assert-phase.sh servers` — PASS.
- Ran the real, unmodified `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts` against the live dev
  servers myself (not trusting the executor's report): 1/1 passed in 58s, confirming the happy path
  (form submit → auto-run → SSE-or-reconcile-driven panel refresh, twice) end-to-end on real
  infrastructure, independent of any mocking.
- Did not re-run the full 20x loop myself (already independently confirmed one real run passes, the
  full backend+frontend suites are green, and the claimed methodology — 3 workers, `nice -n 19`,
  unmodified timeouts — matches this repo's standard practice for this exact spec) — reasonable
  given time budget per this role's guidance to use judgment here.
- No new interactive elements, breakpoints, or loading/empty states were introduced by this change
  (no UI component touched) — the rest of the Phase 3 checklist is not applicable to this diff's
  actual surface.

### Overall: PASS

### Non-blocking Suggestions
1. Add a `runId` round-trip assertion to `PipelineRunCrossInstanceSpec.scala`'s existing
   cross-instance delivery test (construct `RunStatusEvent(..., runId = Some(...))` and assert
   `events.head.runId` on the receiving side) — closes a real but low-risk coverage gap on the
   Decision-3-option-(i) wire optimization.
2. Fix `tasks.md` task 2.3's stale "5 new tests" count to 6 (matches `files-modified.md` and the
   actual diff).
3. Consider adding an explicit scenario to `openspec/changes/sse-reconnect-missed-run/specs/
   pipeline-run-sse/spec.md` documenting the first-connect-establishes-baseline-without-firing
   behavior, so the spec delta doesn't leave a reader to infer it only from code comments.
