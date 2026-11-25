## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 1737116227ffc2d99c28262b0fb7427ea2db20eb (artifacts untracked in the change dir).

### What I verified (with evidence)

- **Failing line.** `e2e/hel1573-motion-grid-chart.spec.ts:115` is
  `await expect(page.locator(".chart-panel__canvas canvas").first()).toBeVisible();`, directly after
  `seedWorld(request, "M-chart")` (:111) and `page.goto("/dashboards")` (:114). Line 104 is the test title. Correct.
- **seedWorld location.** `seedWorld` is declared at `e2e/support/motionPrimitivesSeed.ts:15`. The `/run` POST is at
  :50. The design says the function is at ":50", which is a minor citation slip.
- **"seedWorld returns without waiting for the run to finish" is FALSE against the tree.** This is the central
  finding (see CR1). The evidence:
  - `motionPrimitivesSeed.ts:8-12`: `post()` awaits `request.post`, asserts status < 300, then awaits `res.json()`.
    The `/run` call at :50 is `await`ed.
  - `PipelineRunSubmitRoutes.scala:23-31`: `POST /pipelines/:id/run` is `ServiceResponse.run(runService.submit(...))`.
    `ServiceResponse.scala:34-40` is `onSuccess(result)`, so the HTTP response is sent only when the submit Future
    completes. `chunkedJson` streams an already-computed value (`RunResponseMarshalling.scala:28-35`). It is not an
    early 202.
  - `PipelineRunExecutor.scala` `executeRun` → `runAdmitted` → `runFuture.transformWith` → `executeRunSuccess` →
    `followUp = onRunSuccess(...)` → `runState(runId).flatMap` → `unblockedChain` → `onUnblockedRunSuccess(...).map(Right(_))`
    (:413, :473-487). `PipelineRunSucceededWrites.scala:85-108` writes `node_snapshots` and history inside that
    flatMap chain.
  - So when `POST /run` returns 2xx, the run is terminal and the Output snapshots are committed. The seed does not
    race the run. The test would fail inside seedWorld on a 429 or a failed run, not at :115.
- **Run-status read route.** `GET /api/pipelines/:id/runs/latest` exists (`PipelineRunLatestRoutes.scala:41`), as
  does `GET /api/pipelines/:id/runs/:runId` (`PipelineRunStatusRoutes.scala:31`). The design's example route is real.
- **HEL1829 throttle precedent.** `e2e/hel1572-appearance-preferences.spec.ts:146-154` has an env-gated
  `HEL1829_CPU_THROTTLE` that validates an integer ≥ 1 and calls `Emulation.setCPUThrottlingRate`. The original is
  `e2e/hel1683-regex-main-thread.spec.ts:230`. Correct.
- **panelStatusStore poll.** `frontend/src/features/panels/state/panelStatusStore.ts:13`
  `PANEL_STATUS_POLL_MS = 15000`. Correct. The design's inference that "an Output with no rows at first load may not
  show a canvas for up to a poll interval" only applies if rows are missing at load. The point above shows they
  are not missing.
- **seedWorld callers.** `grep -rln seedWorld e2e` finds 7 callers besides the definition: hel1573-motion-grid-chart,
  hel1584, hel1656, hel1657, hel1681, hel1738, hel1746, and support/hel1573-motion-primitives.ts. That is 8 with
  support/ counted. The design says "7 other callers" and lists 7, which is consistent.
- **Canvas-wait sites.** hel1584:107/:505, hel1573:405, support/hel1573-motion-primitives.ts:64, hel572:171/195/281,
  hel588:212, hel1392:193 and hel1780:463 all exist. D4's list is accurate.
- **AC coverage.** Every ticket AC maps to a task, except "the PR's own CI passes hel1573-motion-grid-chart:104
  without a rerun". No task covers it. See the notes.

### Verdict: REFUTE

The probe-first structure is sound. However, the design states a premise as fact ("returns without waiting for the
run to finish") that the code refutes. It also lists that premise as the first branch of a decision tree that is
"fixed now so the executor does not improvise". If the executor follows that branch, the fix will be an
`expect.poll` on a run that is already terminal when seedWorld returns. That fix is a no-op. Reverting it cannot turn
the test red, so it cannot meet the mutation AC. It also leaves the real cause unfixed. The probe set is also missing
the steps most likely to be pending, now that the seed race is excluded.

### Change Requests

1. **design.md Context: correct the false premise.** Replace "POSTs `/api/pipelines/:id/run` and returns without
   waiting for the run to finish" with what the code shows. `post()` awaits the response, and `POST /run` responds
   only after the run is terminal and `node_snapshots` are written. Cite `PipelineRunSubmitRoutes.scala:23-31`,
   `ServiceResponse.scala:34-40` and `PipelineRunExecutor.scala:413,473-487`. Also correct `motionPrimitivesSeed.ts:50`
   to `:15` for the function, keeping `:50` for the `/run` call. Drop or qualify the "no rows at first load → up to a
   15 s poll" inference, since it rests on the same premise.
2. **D1 probe (a): make it a confirmation of the code reading, not a primary hypothesis.** Record the `/run`
   response (status, `runId`, `blocked`) and `GET /runs/latest` immediately after seedWorld. If the probe ever shows a
   non-terminal run after a 2xx `/run`, that contradicts the code above. It is an app defect to explain, not a
   reason to add a poll.
3. **D1: add the remaining first-render steps to the probe.** With the seed excluded, the 5 s window covers this
   chain after `goto`: session/auth → dashboards list → which dashboard `/dashboards` opens (confirm it is the seeded
   Primary dashboard and not one of the four empty ones created first) → `GET /api/dashboards/:id/panels` →
   `GET /api/outputs/:id/rows` for the chart → the lazy chart chunk → ECharts init and the canvas box size. Record each
   request's start and end time relative to `goto`, and which ones are still pending or unrequested when the 5 s
   lapses. As planned, (b) records only the chunk, and (d) records only the card's content.
4. **D2: restate the decision tree against the corrected premise.** The seed-poll branch should apply only if
   probe (a) contradicts the code reading (CR2). It must not be the default path. Add an explicit branch for "a data
   request (panels or rows) is the pending step", stating whether that is host slowness (escalate) or an app defect
   such as serialised or duplicated fetches or a request gated on a later event (fix the app with a red-first test).
   Also update the Risks entry "Shared seed change slows other specs" and the Planner Notes "e2e-only scope by
   default". Both assume the seed fix is the likely outcome.

### Non-blocking notes

- Add a task (or an orchestrator-owned step) for the AC "the PR's own CI passes hel1573-motion-grid-chart:104 without
  a rerun", for example: record the CI job id and result in the evidence.
- The lane constraint file (C11) cites `hel1573-motion-grid-chart:104`. That is the test's title line, and :115 is
  the failing assertion. Both refer to the same test.
- 40/40 is `--repeat-each=10` over 4 tests. Confirm that the file still has exactly 4 tests when the evidence is
  recorded.
