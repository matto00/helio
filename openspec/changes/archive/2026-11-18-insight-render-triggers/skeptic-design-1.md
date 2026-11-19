## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71 (main; the change dir is untracked planning artifacts).

### What I verified (with evidence)

- **Hook placement (D1): sound.** `PipelineRunSucceededWrites.onUnblockedRunSuccess` returns
  `publishTerminalAfter(pidStr, RunStatusEvent("succeeded", ...), writesChain(), skipPublishOn = RunNoLongerOpen)`
  (PipelineRunSucceededWrites.scala:327-330). `publishTerminalAfter` (PipelineRunTerminalWrites.scala:34-42) publishes
  inside `transformWith` before the returned future completes. A `foreach` on that same future, with the original
  future returned unchanged, cannot delay the publish or change the result. Dry runs go to `onDryRunSuccess`
  (PipelineRunExecutor.scala:349, `if (isDry)`); only real runs reach `onUnblockedRunSuccess` (line 481). A lost
  terminal write fails with `RunNoLongerOpen`, so `foreach` never fires on it. HEL-1564's deleted-pipeline recovery
  turns the result into a success, so a render on a deleted pipeline must find no Outputs; that is harmless.
- **Free tier, zero sends: the guard order is sound.** `AiPipelineQuotaGate.Live` denies `free` and an unknown owner
  (AiPipelineQuotaGate.scala:57-60). Quota comes before send, so no send happens.
- **Weights (R2): the seam exists.** `incrementIfUnderCap(userId, limit, weight = 1)` was added by HEL-1755
  (AssistantDailyUsageRepository.scala:33-45). `ClaudeModelCatalog.weightOf` gives 1 for a non-catalog id.
  `ClaudeToolRequest.model: Option[ClaudeModelSpec]` exists (ClaudeModels.scala:190). `FinalResponse` carries the
  API response model (ClaudeClient.scala:142). `wireTemperature` drops sampling params for catalog ids
  (ClaudeClient.scala:357).
- **Ten identical runs, one call: REFUTED, see CR1.** `InsightInputAdapters.fromResolution` puts
  `current.capturedAt`, `baseline.capturedAt` and every window point's `capturedAt` into the inputs.
  `InsightContextBuilder` serializes `head.capturedAt` and citation `capturedAt` (InsightContextBuilder.scala:92,
  166-176). Every real run inserts a fresh `OutputHistoryInsert` with a new `capturedAt`
  (PipelineRunSucceededWrites.scala:129; OutputHistoryRepository.insertAction has no dedupe), and it rewrites the
  node snapshot. So the "SHA-256 of the pack's serialized text" differs on every run, even when the data is
  identical.
- **Multi-instance daily pass: REFUTED, see CR2.** HEL-1272 uses `pg_try_advisory_xact_lock`
  (OutputHistoryRepository.scala:162, 181), which is transaction-scoped. It does not use the session-scoped lock that
  D5 claims to copy.
- **Daily timing scenario contradicts D5's 15-minute gate: see CR3.**
- **Model validation coverage: see CR4.** Insight configs are also validated and written through
  `OutputService.validateConfig` from `DraftDiff.scala:389-390` (draft save), `PatchSetOutputResolvers.scala:146`
  and `PatchSetPreviewPipelineProjection.scala:28`. `validateConfig` is a companion-object method with no catalog,
  and `InsightConfig.parse` runs inside `OutputConfigValidation.scala:81`.
- **No charge for an unselectable model contradicts the guard order: see CR5.**
- **Manual refresh timeout: see CR6.** The repo sets no `request-timeout`, `withRequestTimeout` or `ServerSettings`
  (grep over `backend/src/main` finds none), so Pekko's default 20 s server request-timeout applies. That is shorter
  than D9's 60 s synchronous bound.
- **Which rows the throttle sees: see CR7.** `InsightRenderOutcome.Failed`/`Rejected` carry no model
  (InsightRenderer.scala:15-19). `OutputInsightInsert.model` defaults to `None`.
- **R3 interpretation: accepted.** The public projection (OutputInsightProtocol.scala:23-28, 102-117) drops ids,
  status, trigger and citation `outputId`. D8 keeps those for a viewer and drops model, tokens, cost, `runId` and
  `inputDigest`. A viewer grantee can already read the pipeline, so citation `outputId` leaks nothing. R3 names only
  model, tokens and cost, and the deviation is self-approved openly in Planner Notes. That is defensible.
- **Role lookup exists.** `accessChecker.requireAccess("pipeline", ...)` returns Owner/Editor/Viewer
  (OutputService.scala:146-148). `PipelineRepository.findGrantRole` also exists (line 186).
- **Scheduler seam.** `runPasses` starts retention and deletion as `Future.delegate(...).recover` without awaiting
  them (PipelineSchedulerService.scala:139-153). D5 copies this pattern correctly.

### Verdict: REFUTE

### Change Requests

1. **The digest is not invariant under identical data (D3, task 2.2, AC "ten runs, one call").** Hashing the
   serialized pack hashes per-run timestamps: `head.capturedAt`, compare `currentAt`/`baselineAt`, window point
   timestamps, and citation `capturedAt`. Each run also adds a window point, and a `previous_run` compare goes from no
   baseline on run 1 to `delta 0` on run 2. As designed, ten identical runs make ten sends.
   - Define the digest inputs so they do not change on an identical-data rerun. For example: head columns and rows,
     compare values and deltas without timestamps, and window values without timestamps, deduplicated or bounded.
     Then state exactly what counts as "identical data", including the run-1 to run-2 baseline transition.
   - Require test 4.4 to drive real runs through the real snapshot and history writes, not a fake that returns the
     same pack. A fixed fake pack would pass while production sends every time.
   - Pin it with a mutation: hashing the raw `serialized` text must turn the test red.
2. **The daily pass's cross-instance lock is wrong (D5, task 2.5).** HEL-1272 uses a transaction-scoped
   `pg_try_advisory_xact_lock`, not a session lock. A session-scoped `pg_try_advisory_lock` through the Slick/Hikari
   pool is unsound: lock and unlock can land on different pooled connections, which leaks the lock onto an idle
   connection and starves every later pass. An xact lock cannot span a pass of up to 50 model calls without holding a
   DB transaction open across network I/O. Specify a mechanism that is actually sound, for example:
   - a pinned session (`withPinnedSession`) that holds one connection for the pass and unlocks in a `finally`, with
     the pool-occupancy cost stated; or
   - a per-Output claim: a short transaction that takes `pg_try_advisory_xact_lock(key, hashtext(outputId))`,
     re-checks "newest attempt older than today 06:00", and writes a claim the second instance will observe.

   Add a two-instance test that shows one render, not two.
3. **The 15-minute pass gate contradicts the daily scenario (D5 vs the spec scenario and task 4.8).** The scenario
   ticks at 05:59, 06:00 and 06:30 and expects one render at 06:00. The 05:59 pass consumes the "at most one pass per
   15 min" gate, so the 06:00 tick is gated out and the render happens at 06:14 or later. Either:
   - define the gate so it cannot suppress the first pass at or after 06:00 UTC (for example, aligned 15-minute
     wall-clock buckets, or a forced pass when the day boundary is crossed); or
   - rewrite the scenario and test to match the real behaviour, and state the worst-case latency.
4. **`model` validation misses most write paths (D7, tasks 1.1-1.2).** Validation is planned only in `OutputService`
   create/update. Draft save (`DraftDiff.scala:389-390`) and patch-set resolution and preview (assistant apply) also
   validate insight configs through `OutputService.validateConfig` → `OutputConfigValidation`. Once `model` joins
   `InsightConfig.Keys`, those paths would store any string, which violates the modified "Insight config contract"
   requirement (a value outside the rules SHALL be 400 naming the key).
   - Put the catalog check in the shared validation path every writer uses, so no path is left out.
   - Add a test that a draft save with `model: "claude-opus-4-8"` gets 400 naming `model`.
   - Note that `validateConfig` is a static method. Say how the catalog reaches it: `ClaudeModelCatalog.fromEnv` at
     the object, or a parameter threaded to every call site.
5. **"Unselectable stored model → failed, no charge" contradicts the guard order (D3 vs D7).** D7 resolves the model
   inside `ClaudeInsightClient` at send time, but D3 charges quota before send. Resolve
   `catalog.select(effectiveModel)` in the service before the quota guard; it is also needed for the digest and the
   weight. Write `failed` with no charge when the model is not selectable, and add a test that asserts the counter is
   unchanged.
6. **The synchronous manual refresh exceeds the server request timeout (D9).** There is no `request-timeout` override
   anywhere in `backend/src/main`, so Pekko's 20 s default applies. A 60 s render bound, or two model calls with the
   validator retry, can return a 503 timeout while the render continues and is charged. Choose and state one:
   - `withRequestTimeout` on this route, with a test; or
   - a manual-render bound under 20 s; or
   - `202` plus polling `GET /insight`.
7. **State which rows record `model`, because the throttle depends on it (D4).** "Newest attempt with model IS NOT
   NULL" only throttles if every attempt that reached the model records the model id. That includes `Rejected`,
   `Failed` after a send, and the 60 s timeout. The renderer's `Failed`/`Rejected` outcomes carry no model, and
   `OutputInsightInsert.model` defaults to `None`.
   - Specify that the service writes the requested model id on every row where a send was attempted, and null only
     for `skipped_*`.
   - Add a test: a failing model is not called again within the hour by an automatic trigger. Otherwise a broken or
     rejecting model is called on every run with no throttle.

### Non-blocking notes

- D8: pick one role mechanism. Prefer `accessChecker.requireAccess` (Owner/Editor/Viewer), not "findGrantRole or the
  checker". `findGrantRole` returns `None` for the owner and needs a separate owner check.
- D2: after a 60 s timeout writes `failed`, a late-completing future must not also write a row or publish
  `InsightRendered`. State this and cover it in 4.1.
- D4 catch-up: state the `trigger` (`on_run`?) and `run_id` (the latest run id, or null) of a catch-up render, and the
  source of "latest succeeded run": `pipelines.last_run_at`/`last_run_status`, given that `pipeline_runs` keeps only
  10 rows.
- Task 1.3: two test fakes (`AiPipelineQuotaGateSpec`, `ClaudeAiStepClientSpec`) override `checkAndIncrement` and must
  change signature. This is expected, not a regression.
- Task 2.7: watch `ApiRoutes` declaration order. A val referenced before it is declared captures `null` silently; the
  `AiPipelineQuotaGate` scaladoc records this hazard.
- Free-tier on_run on a frequently scheduled pipeline writes one `skipped_quota` row per run, because the throttle
  ignores null-model rows. Retention bounds it, but say so.
- A dangling `reads.outputs` id (allowed by the existing insight-output-kind spec) must be skipped during input
  assembly, not fail the render.
