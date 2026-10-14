## Context

See proposal.md (Why). This is a spike: the deliverable is `docs/live-draft-preview.md`, the prototype evidence and
`measurements.md`. This file plans how they are produced and fixes the facts they must start from. All facts below
were read from the tree at `5074b6937` and must be re-verified (not transcribed) by whoever writes the doc.

- Step kinds: 27 registered in `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` (Registry), code in
  `domain/steps/*Step.scala`. `evaluate(rows, ctx): Future[Seq[Row]]`; 20 are pure primary-input transforms and 7 use the execution context:
  `join`/`union`/`lookup` take a lane or a source secondary (`ctx.resolveLane`, `ctx.loadSource`); `analyzewithai`/
  `generatetext` call `ctx.aiClient` (owner-charged, tier-gated via `AiPipelineQuotaGate`); `upsertsource` records a
  `PendingWrite`; `assert` writes `ctx.assertionSink` and blocks real runs on error-severity failures only.
- Expression language: Scala only (`domain/engine/Expression*.scala`, ~1,580 lines incl. static analysis), spec in
  `docs/compute-expression-grammar.md`. Doubles throughout, three-valued logic, `round` half-up on shortest decimal,
  Java `Double.toString` in concatenation, legacy bare-identifier fallback, UTC-only date functions.
- TS↔Scala parity precedent is established: 12 of the 13 files in `shared-test-fixtures/` are read by both a Scala
  spec and a Jest test. Closest precedent: `output-summary-reducer.json`, which holds a TS aggregate evaluator
  (`frontend/src/utils/aggregate.ts`) to a Scala port (`OutputSummaryReducerSeamSpec`). Also relevant:
  `chart-timestamp-parsing.json` (TS `parseChartInstant`) and `window-rolling-seam.json`.
- Preview today: `GET /api/pipelines/:id/steps/:stepId/preview`, `POST /api/pipelines/:id/preview` (no body) in
  `PipelineRunStatusRoutes.scala` → `PipelineRunPreview.scala`. Saved config only, full-closure re-run, live source
  re-fetch every call, 10 rows returned. Covered only by the general `/api` limiter (120/min/instance), not the HEL-505
  run or source-fetch limiters. REST/SQL reads are head-capped at `MaxRunRows = 1000`
  (`InProcessPipelineEngine.scala:112`); no stored sample exists for REST/SQL.
- Edits persist live: `useStepCardPersist.ts` PATCHes `/api/pipeline-steps/:id` after 400 ms. There is no bulk
  pipeline write; `POST /api/patch-sets/apply` (sequential with compensating rollback, undoable via
  `PatchSetUndoService`) is the closest atomic-ish, undoable path.
- Render seam exists: `OutputPreviewPane.tsx` renders `ChartRenderer`/`MetricRenderer` from in-memory rows plus an
  unsaved Output config; `OutputPanelContent.tsx` takes `rawRows`/`headers`/`output` as props.
- SSE: `GET /api/pipelines/:id/run-events` (`PipelineRunStreamRoutes.scala`), hand-built chunked `text/event-stream`,
  no heartbeat, server closes every stream at each terminal run status; client reads it with fetch + ReadableStream
  (cookie needs `credentials: "include"`), shared per pipeline by `pipelineRunFanout.ts`, which aborts immediately on
  the last unsubscribe. The reopen-per-crossing cost (HEL-1438 item 2) is documented in
  `openspec/changes/archive/2026-10-09-panel-remount-row-refetch/design.md` and its `probe-premise.md`.
- Owner ruling (start-now): UI answers target the approved boards (`PipelineLive*`, `MotionLive--preview-*`), not
  today's page. Board pipeline: Filter `duration_s ≥ 260` → Sort `date ↑` → Add column `duration_min = duration_s / 60`.

## Goals / Non-Goals

**Goals:** a doc that answers Q1–Q6 with a recommendation and rejected alternatives each; a cited step-kind table; a
failable parity mechanism; a reproducible real-browser latency number; transport grounded in measurements; HEL-1581
scope confirmed or adjusted.

**Non-Goals:** any product code; any new dependency; editing HEL-1581's description; touching `DESIGN.md` or
`frontend/src/theme/`.

## Decisions

**D1. Where the write-up lives: `docs/live-draft-preview.md`.** The OpenSpec design is capped at 150 lines and is
archived with the change; HEL-1581 and its follow-ups need a durable, linkable reference, like
`docs/compute-expression-grammar.md`. Alternative rejected: answer inside this design.md (too small, archived).

**D2. Prototype is a self-contained HTML page plus a Node driver, in `prototype/` inside this change dir.** The page
holds plain JS, with no imports or npm dependencies. It contains a deterministic 1,000-row generator shaped like the
board's `runs` source, and a minimal evaluator for the board's three steps. That evaluator includes a small
tokenizer/parser for the compute expression and the filter numeric coercion, so the parse cost is counted. An
`edit()` simulates a filter-threshold drag and recomputes from the edited step downward. It times recompute alone and
recompute plus DOM render (preview table, a simple SVG line and two metric tiles for the Output, as on the board).
The render timing must include style and layout: force a synchronous layout (read `offsetHeight` after the writes)
and also report time to the next frame (`requestAnimationFrame` then a `MessageChannel` post), stating which is
which in `measurements.md`. The 500 measured edits vary the filter threshold across the column's range
(deterministic sequence), so surviving-row counts vary. The driver uses the repo's existing
`playwright-core` (1.55.1, Chromium revision 1193 already in `~/.cache/ms-playwright`) to launch its own headless
Chromium. It does not use the shared Playwright MCP browser, which can be stolen by a peer session (MISTAKES.md). The worktree has no `node_modules`;
the reproduce command names the module path explicitly (via `createRequire` or an absolute `index.mjs` import of
`/home/matt/Development/helio/node_modules/playwright-core`; `NODE_PATH` is ignored by Node's ESM loader), and `measurements.md` records the resolved `playwright-core` version and path, the Chromium
version string from `browser.version()`, and whether the headless shell or full Chromium ran. The
driver loads the page via `file://` and reads `performance.now()` timings: 50 warm-up edits, then 500 measured edits,
reporting median, p95 and max. It runs twice: unthrottled, and with CDP `Emulation.setCPUThrottlingRate` at 4x as a
low-end-device proxy. `openspec/**` is ESLint- and Prettier-ignored, and nothing imports it, so it cannot ship.
Rejected alternatives: a Vite page importing real renderers (couples throwaway code to product code); jsdom or Node
(not a browser; the ticket forbids it).

**D3. Parity mechanism (to be specified in the doc, not built).** A shared vector corpus under
`shared-test-fixtures/`, `{kind, config, inputRows, expectedRows | expectedError}`, read by both a ScalaTest spec
that runs the real `XStep.evaluate` and a Jest spec that runs the TS evaluator. The classification lives in one
place: a corpus manifest (`shared-test-fixtures/pipeline-step-parity/manifest.json`, `{kind: "client" | "server"}`).
A ScalaTest iterates the real `PipelineStep` Registry and fails if any registered kind is missing from the manifest or
the manifest names an unregistered kind. A Jest test fails if the TS evaluator's kind set differs from the manifest's
"client" set, or if a "client" kind has fewer than a set number of vectors. Example mutations to name: a new Scala
kind added without a manifest entry (Scala check red); a TS `round` using `Math.round` (vector red on `-2.5`). The
doc must give a concrete mutation for each check, and must say per area whether the client evaluator reuses existing
TS (`aggregate.ts`, `parseChartInstant`) or duplicates Scala logic (window rolling has no TS evaluator:
`window-rolling-seam.json` checks config only, so a client window evaluator is duplication). Alternatives the doc must weigh: Scala.js cross-compiling the
evaluator (no duplication, new build toolchain), and server-only evaluation via a draft-preview endpoint (no
duplication, a network call per edit).

**D4. Transport evidence before any recommendation.** Measure cheaply on this worktree's own dev servers
(`DEV_PORT=7012`, `BACKEND_PORT=9919`, via `scripts/concertino/start-servers.sh`):
- the round trip of the existing step preview endpoint for a board-shaped 3-step pipeline over a dataset source
  (median of at least 20 calls; local, so no network RTT; label it so);
- the run-events open-to-first-byte cost, if it is cheap.
Any fixture rows created in the shared dev DB are deleted by exact id afterwards, and the ids are recorded. Ground
the comparison in the facts above (no heartbeat, terminal-close, fetch-stream reader, Cloud Run concurrency 80 / max 2
instances, the `/api` 120/min limiter, the HEL-1392 burst measurement).

**D5. Owner escalation for genuine calls.** The executor drafts the doc with its recommendation, then raises ONE
multi-part `ESCALATION` (sub_questions form) for every genuine product or architecture call that remains. Expected
candidates:
(a) the transport for server-evaluated steps;
(b) a hand-written TS evaluator plus vector corpus, vs Scala.js, vs server-only;
(c) the sample cache location (a server sample store is new persistence; vs client memory/IndexedDB);
(d) the Save & run write path (reuse `POST /api/patch-sets/apply` vs a new bulk pipeline write).
Each sub-question carries bounded options with the recommendation stated. The owner's exact answer tokens are then
recorded in the doc. Self-approval test (standing constraint C1): a call may be self-approved only when the doc shows
why every alternative is not viable, or names the owner ruling that settles it. Otherwise it is escalated.

**D6. HEL-1581 scope.** The doc ends with a section that walks HEL-1581's five acceptance criteria one by one
(stands / adjusted / split, with why). It must resolve one conflict explicitly: HEL-1581 requires a client-side edit to
make no network request, but its Output summary shows "difference vs the last run", which today comes from
`GET /api/outputs/:id/history`. Example resolution: fetch the baseline once per page load and cache it. Examples: the TS evaluator plus corpus; a draft-preview endpoint that takes draft steps and a
sample; a server sample store; draft mode with Save & run through patch-sets. The orchestrator (not the executor, which has no Linear
write tool) posts that section as a comment on HEL-1581 at Delivery, after the final gate, and never edits HEL-1581's
description.

## Risks / Trade-offs

- [The prototype's evaluator is simpler than a faithful port, so the number is optimistic] → the doc states exactly
  what the prototype includes and omits. It also adds a cost estimate for the omitted fidelity (e.g. a `round` via
  decimal string). The 4x-throttled run shows the headroom.
- [The local preview round trip has no network RTT] → label it local and add a stated RTT assumption; no
  extrapolation is presented as measured.
- [Dev DB residue from the measurement fixtures] → exact-id cleanup, with the ids recorded in `measurements.md`.
- [A server draft preview inherits owner-charged AI calls (`PipelineRunPreview.scala` executes enabled AI steps)] →
  the doc's Q1/Q4 must state how AI steps are excluded or explicitly charged in a draft preview.
- [Stale facts transcribed from this file] → the doc cites file:line from fresh reads; the evaluator and skeptic
  spot-check.

## Planner Notes

- Self-approved: D1 (docs location), D2 (prototype placement and harness), `skip_specs: true` (no behaviour change).
- Escalation is deferred to the executor (D5) so that the owner rules with the measurements in hand.
- HEL-1438's SSE reopen note lives in Linear (item 2) and in the HEL-1392 archive, not in a HEL-1438 change dir.
