## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, .openspec.yaml (untracked, HEAD 5074b69377ea8ce1010739dddcf858448a3a0af5).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/live-draft-preview-spike/HEL-1580`.
- **Owner ruling start-now:** `.concertino/runs/HEL-1580/events.jsonl` line 1 is `escalation.answered`, `answer_source":"human"`, `resolution_channel":"chat"`, answer "start-now: owner approves starting the HEL-1580 spike before its Linear blocker HEL-1579 lands; UI-facing answers are written against the approved HEL-1570 boards". It comes before `run.start` (line 2). Verified.
- **Board pipeline:** `PipelineDesktop.dc.html` contains `duration_s ≥ ${thresh}`, `Sort rows … date`, `duration_s / 60`. `PipelineLive--step1-filter-dragged.png` shows Filter → Sort → Add column, a live chart, and tiles for "ROWS OUT 20 / -2 vs last run" and "AVG MINUTES". The design's statement of the board pipeline is correct.
- **27 registered kinds:** true. `PipelineStep.scala:256-284` has 27 Registry entries, and there are 27 `domain/steps/*Step.scala` files.
- **"21 are pure":** wrong. A grep for `ctx.<member>` shows 7 kinds touch the context: join, union, lookup (`resolveLane`/`loadSource`), analyzewithai, generatetext (`aiClient`), assert (`assertionSink`), upsertsource (`writeBackSink.record(PendingWrite…)`, line 33). That leaves 20 pure kinds. The design's own list adds up to 21+3+2+1+1 = 28.
- **Preview runs saved config only, takes 10 rows, and re-fetches:** true. `PipelineRunStatusRoutes.scala:38-46` defines the GET step preview and the POST preview. `PipelineRunPreview.scala` reads the pipeline from the repo and returns `allJsRows.take(10)` (lines 205, 293). `MaxRunRows = 1000` is at `InProcessPipelineEngine.scala:112`.
- **Limiter coverage:** true. `ApiRoutes.scala:920-922` threads `sourceFetchRateLimitDirective` only into `DataSourcePreviewRoutes`/`SourcePreviewRoutes`. `PipelineRunStatusRoutes` (line 967) gets no extra limiter.
- **useStepCardPersist PATCH after 400 ms:** true. `STEP_CONFIG_PERSIST_DEBOUNCE_MS = 400` at line 18.
- **SSE and fanout:** the fanout fetches with `credentials: "include"` (`pipelineRunFanout.ts:184,252`) and aborts on close (line 151). `usePipelineRunEvents.ts` is one of its consumers. `PipelineRunStreamRoutes.scala:45` builds a hand-made `HttpEntity.Chunked` stream. A grep found no heartbeat or keepAlive in the stream or registry code. The archive `2026-10-09-panel-remount-row-refetch/{design.md,probe-premise.md}` exists. Consistent with the design.
- **Render seam:** true. `OutputPreviewPane.tsx:25-26` imports `ChartRenderer`/`MetricRenderer` and renders unsaved config over rows on the client. `OutputPanelContent.tsx:40-41` takes `rawRows` and `headers` props.
- **"Only existing TS↔Scala parity precedent: chart-timestamp-parsing.json":** FALSE. See CR1. `shared-test-fixtures/` holds 13 fixtures, and 12 of them are read by both a Scala spec and a Jest test. One of them is `output-summary-reducer.json`. Its consumers are `frontend/src/utils/aggregate.fixture.test.ts`, which runs the real TS `computeAggregate`/`groupAndAggregate`, and `OutputSummaryReducerSeamSpec.scala` ("the backend port cannot drift from the frontend"). That is an existing TS aggregate evaluator with a Scala parity port, and it is exactly the precedent Q1/D3 needs.
- **Prototype tooling:** `~/.cache/ms-playwright/chromium-1193` exists. The main checkout's `node_modules/playwright-core` is 1.55.1 (`browsers.json`: chromium 1193, browserVersion 140.0.7339.186). **The worktree has no root `node_modules`** (`ls node_modules` → No such file or directory). `openspec/**` is ignored by both ESLint and Prettier (`eslint.config.cjs:14`, `.prettierignore:5`).
- **HEL-1581** (Linear, Backlog, blockedBy HEL-1580) has 5 explicit ACs. One is "Editing a client-evaluable step updates counts, preview and Output render with **no network request**". Its live Output column also requires "the difference vs the last run".

### Verdict: REFUTE

The plan is mostly well grounded and the prototype is the right shape. However, one stated fact would steer the central Q1/parity answer wrong. The render timing would also produce a misleading number, and the parity and escalation plans each leave a gap the ticket explicitly forbids.

### Change Requests

1. **design.md Context, "Only existing TS↔Scala parity precedent" bullet, and D3 ("follows the chart-timestamp-parsing.json precedent"): correct the false claim.**
   - State that 12 of the 13 `shared-test-fixtures/*.json` already back paired Scala/Jest seam specs.
   - Name `output-summary-reducer.json`, `frontend/src/utils/aggregate.ts` and `OutputSummaryReducerSeamSpec.scala` as the closest precedent. It is an existing TS evaluator (aggregate / group-and-aggregate) whose Scala side is held to parity.
   - Note that `window-rolling-seam.json` and `compute-expression-functions.json` already exist for two candidate client kinds.
   - Make task 3.2 require the doc to say whether the aggregate path reuses `aggregate.ts` or duplicates it. The ticket asks to "reuse existing evaluator code paths where possible".
2. **design.md Context, step-kind bullet: fix the count.** It is 20 pure kinds plus 7 that use the context (join/union/lookup, analyzewithai/generatetext, upsertsource, assert), not 21. Task 3.1 should verify the 20/7 split as well as the 27 total.
3. **D2 / task 1.2: define what the "recompute + render" timing actually measures.** `performance.now()` taken right after synchronous DOM writes excludes style, layout and paint, so it would report a render cost that never happened. Use one of these and name it in `measurements.md`:
   - force a synchronous layout (for example, read `getBoundingClientRect()`/`offsetHeight` on the table and SVG) before the end stamp; or
   - measure to the next frame (`requestAnimationFrame` followed by a `setTimeout(0)`/`MessageChannel` callback).

   Also state that the 500 edits use varying thresholds, so each one changes the filtered set. Repeated identical inputs flatter JIT and branch prediction.
4. **D2 / task 1.3: make the prototype's dependency resolution explicit and reproducible.** The worktree has no root `node_modules`. `import "playwright-core"` from `openspec/changes/.../prototype/` resolves only by walking up out of the worktree into the main checkout's `/home/matt/Development/helio/node_modules`. That is an accident of the nested worktree path and is not repeatable from a normal clone. The reproduce command must name the module path explicitly, for example `createRequire` of an absolute path or `NODE_PATH`, or state the prerequisite `npm ci` at the repo root. `measurements.md` must record the resolved `playwright-core` version and path, the Chromium `browserVersion`, and whether it ran under `headless_shell` or full Chromium.
5. **D3: say where the Scala-side "client-evaluable" classification lives, so the registry-agreement check can actually fail.** Today `PipelineStep.Registry`/`Companion` has no client-evaluable notion. As written, "the TS registry and the Scala Registry disagree on the client-evaluable set" has nothing on the Scala side to disagree with. Specify the mechanism. One option: a corpus manifest classifying every kind, plus a ScalaTest that iterates `PipelineStep.Registry.keys` and fails on any kind that is (a) unclassified or (b) client-evaluable with fewer than N vectors. Another is a `Companion` flag. Then give the mutation that check catches, for example "registering a 28th kind without classifying it fails X", alongside the per-check mutations D3 already requires.
6. **D5: replace "calls the evidence makes clear-cut are self-approved" with a stated test, and widen the candidate list.** The ticket routes every "genuine product/architecture call between viable options" to the owner. Two more such calls are plainly in scope:
   - **Q2:** where the non-static sample is cached. A server sample store means new persistence, schema and refresh semantics under the HEL-505 limits; client memory or IndexedDB does not.
   - **Q6:** the Save & run write path. Reusing `POST /api/patch-sets/apply` versus a new bulk pipeline write is an API/contract decision.

   D5 must either list these as escalation candidates, or require the doc to show that only one option is viable before self-approving. Self-approvals are recorded in the doc with that justification.
7. **tasks.md: make AC4 (HEL-1581 scope) concrete and owned.**
   - (a) Task 3.6 must walk HEL-1581's five ACs individually (no-network client edit; server-only transport within HEL-505; Discard/Save & run/undo consistency; Output render parity test; sample label and age), each marked stands, adjusted or split.
   - (b) It must specifically address the conflict between "no network request" and the live Output summary's "difference vs the last run", which today needs `GET /api/outputs/:id/history`. The answer could be to prefetch once per session, or to carve this out of the AC.
   - (c) Add a task for posting the scope section as a comment on HEL-1581. Name who posts it and when (D6 says the orchestrator at Delivery), and state that the description is never edited. At present no task covers AC4's "confirmed" action.

### Non-blocking notes

- The prototype's Output render is a table plus an SVG line. The board also shows metric tiles (rows out, average minutes). A cheap aggregate over the draft rows would make the measured render closer to the board.
- `PipelineRunPreview.scala:267` executes AI steps in preview when the closure has an enabled AI step (`requireEditor = closureHasEnabledAiStep`). The doc's Q1/Q4 should note that a server draft preview inherits owner-charged AI calls, and how that interacts with the general `/api` limiter only.
- `.openspec.yaml` `skip_specs: true` is appropriate for a spike.
