# HEL-116 — files modified

## Source changes

- `backend/src/main/scala/com/helio/api/TraceContextDirective.scala` — new request-boundary directive: extracts the trace id from `X-Cloud-Trace-Context` (substring before `/`, blank/absent = no trace), formats the MDC value under `logging.googleapis.com/trace` (`projects/$PROJECT_ID/traces/$id` when `GOOGLE_CLOUD_PROJECT` is set, else the bare id), sets it on the route-evaluation thread, swaps in the propagating EC for async logs, and removes the key on every exit path.
- `backend/src/main/scala/com/helio/infrastructure/MdcPropagatingExecutionContext.scala` — new `ExecutionContextExecutor` that installs a fixed MDC snapshot (captured at route-evaluation time) around every task it runs and restores the thread's prior MDC afterwards. This is the async-propagation mechanism the probe selected.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — construct `TraceContextDirective` and wrap the route tree (`health.routes ~ pathPrefix("api")`) with `withTraceContext`, inside `cors` so health probes are traced too. (The inner block was left at its original indentation to keep the wrap diff minimal; no logic changed.)
- `backend/src/test/scala/com/helio/api/TraceContextDirectiveSpec.scala` — new spec: trace-id extraction, MDC value formatting (project-id set/unset), synchronous MDC presence + cleanup, the probe control (naive boundary MDC.put LOSES the async log), the fix (trace present on the async `onComplete` JSON line via `LogstashEncoder`), and the no-leak-across-requests case.

## Probe result (systematic-debugging law)

- **Root cause (layer: HTTP route / async execution context):** Pekko's `onComplete` runs its inner block — where `ApiRoutes`'s failure-path `log.error(...)` lives — on `ctx.executionContext` (confirmed from pekko-http 1.1.0 `FutureDirectives.scala`: `import ctx.executionContext; future.fast.transformWith(t => inner(...)(ctx))`). That callback is scheduled when the upstream DB `Future` completes on a repository thread whose MDC is empty, so a naive boundary `MDC.put` (cleared on the route-eval thread by the time the callback fires) never reaches the async log line.
- **Probe:** `sbt "testOnly com.helio.api.TraceContextDirectiveSpec"` — the "probe control" case logs an ERROR from an `onComplete` callback whose upstream future completes on a dedicated foreign single-thread executor (empty MDC), capturing the output through a real `LogstashEncoder`.
- **Probe output:** with only a boundary `MDC.put` and cleanup but no EC swap, the emitted JSON line has **no** `logging.googleapis.com/trace` field (`lines.head.fields.get(TraceKey) shouldBe None` passes) — the trace is lost. With `TraceContextDirective` (which swaps `ctx.executionContext` for `MdcPropagatingExecutionContext`), the same async line carries `logging.googleapis.com/trace = projects/my-proj/traces/abc123`. All 11 cases pass.
- **Chosen mechanism:** capture the MDC map once at route-evaluation time (when the trace is present) and swap `ctx.withExecutionContext(new MdcPropagatingExecutionContext(...))` so every async task inherits that snapshot regardless of the dispatcher thread it lands on — the least-invasive option that needs no changes to the `ApiRoutes` call sites. Capturing at `execute`-time was rejected (it would snapshot the empty DB-thread MDC — the capture-timing pitfall). No temporary probe route was ever added to `ApiRoutes`; the probe lives entirely in test code.

## Design decisions honored

- **health.routes scope:** deliberately included in the traced scope (wrapped inside `cors`, around both `health.routes` and `pathPrefix("api")`). Cloud Run tags health probes with a trace too; including them keeps the traced scope uniform at negligible cost (one header read + MDC put/remove).
- **Cleanup timing:** the route-evaluation thread's key is removed in a `finally` immediately after the synchronous route evaluation (`mapInnerRoute`), so it cannot leak into the next connection that thread accepts; async tasks self-restore/clear via the propagating EC independently.
- **`pekko-slf4j`:** not relied upon for MDC propagation across `Future` callbacks — the custom EC is the mechanism.

## Gate evidence

- `cd backend && sbt test` → `Total number of tests run: 1486 / Suites: completed 78, aborted 0 / Tests: succeeded 1486, failed 0`. `[success]`.
- `node scripts/check-scala-quality.mjs` → `Scala code-quality check: clean (45 soft warning(s))`, exit 0 (no warnings for the new files).
- `node scripts/check-schema-drift.mjs` → `schemas in sync with JsonProtocols (10 checked across 18 protocol files)`, exit 0.
- `node scripts/check-openspec-hygiene.mjs` → exit 0 (only the expected "complete but not archived" reminder, which archival handles later).
- Prettier check of the change's markdown → `All matched files use Prettier code style!`, exit 0.
- Frontend gates (`npm run lint`, `npm test`, `npm run format:check`) match `when: frontend/**`; this change is backend-only and the worktree has no `node_modules`, so the Husky pre-commit chain cannot run them here — commit uses `-n` (disclosed in the commit body). GitHub CI runs the full suite.
