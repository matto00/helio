## Context

L1 (HEL-1740), L3 (HEL-1741), L2 (HEL-1742) and HEL-1755 shipped the kind, renderer, store and model catalog; nothing
calls the renderer yet. Non-goals: UI, ask, MCP, HEL-919 delivery, enforcing dollars, a new timer, a migration.

## Decisions

**D1 Hook outside the writes chain.** In `PipelineRunSucceededWrites`, the `publishTerminalAfter(...)` future is
returned unchanged; on its *successful* completion (`foreach`, never `flatMap`/`andThen` into the returned value) call
`insightTrigger.afterRunSucceeded(pipelineId, runId)` wrapped in `Future.delegate(...).recover` with a WARN. The
trigger is an injected trait (`InsightRunTrigger`, no-op default) so the run path never depends on Claude. Dry runs go
through `PipelineRunTerminalWrites`' dry-run path and never reach this call; draft previews never run writes. A
`RunNoLongerOpen` skip completes as a failure/skip and does not trigger. Fail-first test: a fake model that never
completes and one that throws; the run's returned future and its `succeeded` event complete on the same test-clock
step as with no insight Outputs at all.

**D2 `InsightRenderService` and the input recipe.** Methods `renderForRun(pipelineId, runId)`, `tickPass(now)`,
`refresh(outputId, user)`, `latestFor(outputId)`. All reads on the privileged path (no user context on scheduler/run
paths). The stored config is parsed with a permissive model predicate (`_ => true`); D7 then resolves the model.
Inputs (`InsightInputs`, first production caller):
- Read set: `reads.outputs` when present, dropping ids that are gone, in another pipeline or of kind `insight` (never
  a failure); when absent, every other non-insight Output on the insight's node (`Output.node`, same `NodeRef`). Empty
  set allowed.
- Head: `outputId` = the insight's own id; rows = the insight node's latest snapshot via `NodeSnapshotRepository`
  (internal read, `limit = InsightLimits.maxHeadRows`), columns in node schema order; `capturedAt` =
  `pipelines.last_run_at`. None when no snapshot. The digest covers exactly these head rows.
- Compares: per read Output, `OutputHistoryService.forOutput(output, itsConfig, limit = 30, since = None)` mapped by
  `InsightInputAdapters.fromResolution`; only its `compare` is used (None without a compare token).
- Windows: only from `reads.windows`. For each token `w` and each read Output: `forOutput(output, itsConfig, limit =
  100, since = Some(now - w))`; the window is the adapter's points relabelled with `w` (not the compare token);
  dropped when empty. No `reads.windows` -> no windows.
- Preset (per the binding grounding spec, independent of `reads`): `InsightPresetInference.infer(config.preset,
  InsightNodeSignals(the insight node's own non-insight Outputs (kind, config), that node's column types, stepOps))`,
  `stepOps` = op names of the ENABLED steps on the node's primary `parentStepId` chain, root first (lane/secondary
  inputs excluded), built by a new `InsightNodeSignalsBuilder.parentChainOps`. The digest hashes the EFFECTIVE preset.
  Then: resolve the model (D7); `InsightRenderer.prepare` (split `render` into `prepare` -> `InsightBuiltPrompt |
  PackTooLarge` and `send`, `render` kept as their composition so L3 tests stay valid); guards (D3); send. The render
  (send plus the one validator retry) is raced against a 30 s timeout (constructor parameter) through a `Promise`:
  first completion wins; a timeout writes `failed`; a late result writes no row and publishes nothing. The Output
  leaves the in-process in-flight set only when the underlying send future completes (not at the timeout), so a hung
  send cannot overlap a second one in this process. `PackTooLarge` writes `skipped_budget` (no send, no charge). One
  row per outcome except the hourly throttle and an in-flight duplicate (no row, logged); both are caught up by D5
  (predicate below). Every row's `created_at` is the render's START instant from the injected clock (never insert
  time; a coalescing UPDATE uses `GREATEST(created_at, start)`). Inserts return the row
  id (`RETURNING id`) for the event. Tests: `auto` -> `delta` with a metric+compare sibling; a read Output on another
  node does not change the preset; absent `reads.outputs` reads the node's siblings. A hung send releases only via the
  transport's own timeouts (`HttpClaudeTransport`: 10 s connect, 60 s read); a transport change must keep that true.

**D3 Digest = data, not time (CR1).** The digest is SHA-256 over a canonical encoding of: preset, prompt,
maxSentences, maxChars, effective model id; the head's columns and row cell values (no `capturedAt`); for each compare
its current value and its delta, where an absent baseline and a zero delta encode identically as `flat`; for each
window its label and its point VALUES with consecutive equal values collapsed (no timestamps). It never hashes
`InsightPack.serialized`. "Identical data" therefore means: same head rows and same values in every compare/window
after collapsing repeats. Consequences, stated: a rerun with unchanged data skips even though a new history point and
a first `previous_run` baseline (delta 0) appeared; a narrative is not re-rendered just because time passed; a time
window whose distinct values change (an old value aged out) does re-render. Compared with `latestOk.inputDigest`, so a
failed/rejected attempt never blocks a retry of the same data. Guard order digest -> hourly -> quota -> send:
unchanged data never spends quota, and a throttled render is never charged. Test 4.4 drives ten REAL runs through the
real snapshot and history writes (DB-backed spec, fake model transport); a recorded mutation hashing `serialized`
turns it red.

**D4 Hourly throttle and which rows record `model`.** Every row written after the service invoked the model client
records the REQUESTED model id (`ok`, `Rejected`, `failed` after a send, the timeout) EXCEPT an `Unavailable` failure
(no API key: nothing was sent). `model` is null on `skipped_*`, unselectable-model and `Unavailable` rows. When the
wired client is the `InsightModelClient.Unavailable` default, the service writes `failed` before the quota guard, so a
keyless backend never charges anyone. Automatic triggers skip when the newest attempt with `model IS NOT NULL` is
younger than 1 h, so a broken model is called at most once an hour per Output. A throttled on_run render writes no
row; the D5 pass catches it up. Catch-up predicate: an `on_run` insight whose last model call is >= 1 h old and whose
pipeline's `last_run_at` (ANY status: a later failed run must not hide an earlier success) is >= its newest attempt's
`created_at` minus a 10-minute overlap grace. `last_run_at` is stamped when a run's writes BEGIN and runs of one
pipeline can overlap (manual runs have no overlap check), so a run that began writing before a render started but
committed after it read its inputs is still selected as long as its write phase takes < 10 min (the stated residual
bound). A false positive costs one digest check plus a coalesced-row update: no send, no quota. The loop terminates
because the catch-up's own row is stamped >= 1 h after that run. Renders with trigger `on_run`, `run_id` null. Manual
refresh bypasses the throttle but not digest or quota. Coalescing (store sizing; `OutputInsightRepository.purge`
assumes small volumes): a no-send outcome whose status equals the newest attempt's is not inserted; instead that row
is UPDATEd by id with this attempt's `created_at` (render start), `trigger`, `run_id` and `input_digest`. It applies
to `skipped_quota` and `skipped_budget` on status alone; a null-model `failed` (unselectable model, keyless
`Unavailable`) merges ONLY into a newest row that is also `failed` with null model (never into a row that carries a
model, tokens or cost); and to `skipped_unchanged` on status alone too (its digest equals `latestOk`'s by definition). So ten identical
runs leave one `ok` and one `skipped_unchanged` row; a free-tier Output holds one `skipped_quota` row however its data
changes; a daily pass coalescing into an `on_run` skip row relabels it `daily`. Rows per insight per day are bounded
by about 24 model-call rows + one row per status change.

**D5 Tick pass: 06:00 UTC daily, aligned gate, pinned-session lock.** `PipelineSchedulerService.runPasses` starts
`insightRenderService.tickPass(now)` like retention/deletion (started, not awaited, `recover` logs). Gate: one pass
per aligned 15-minute wall-clock bucket (`floor(epochSeconds / 900)`), one in flight per process; 05:59 and 06:00 are
different buckets. Cross-instance: `withSystemContext` always wraps `.transactionally`, so add
`DbContext.withSystemPinnedSession[R](action: DBIO[R]): Future[R] = privilegedDb.run(action.withPinnedSession)` (NO
transaction; call sites carry the bypass comment). The pass is `lock >> DBIO.from(renders) cleanUp unlock` on that
pinned session: `pg_try_advisory_lock(<fixed key>)`, candidates re-selected under the lock, renders sequential (their
own DB work on other pooled connections), `pg_advisory_unlock` in `cleanUp`; not acquired = skip the bucket. No
transaction is open across model calls. Cost: one of 5 privileged connections held for the pass; cap 10 renders that
reach the model per pass (throttled/unchanged/quota-skipped candidates do not count), worst case about 10 x 30 s;
leftovers go to the next bucket. If unlock fails it is logged ERROR and the lock stays on that pooled connection until
Hikari recycles it (`maxLifetime`, 30 min): passes skip until then; accepted. Daily selection: `refresh = daily`, `now
>= today 06:00 UTC`, newest attempt older than today 06:00 UTC (restart-safe). Tests: 05:59 none, 06:00 one, 06:10
none, 06:30 none; two service instances on one DB concurrently -> one send; lock held -> skip; a failing pass never
fails the tick.

**D6 Billing and weights (R2).** `AiPipelineQuotaGate.checkAndIncrement(owner, weight: Int = 1)`; `Live` forwards the
weight to `incrementIfUnderCap`. Existing AI-step callers keep weight 1; the two test fakes overriding the method
(both in `ClaudeAiStepClientSpec`) change signature (expected). A render charges `catalog.weightOf(effectiveModelId)`
once, before the send; the validator retry is not charged again. Owner tier never counted; free tier and an unknown
owner denied -> `skipped_quota`.

**D7 Model (R1).** `InsightConfig.parse` takes a REQUIRED `isSelectableModel: String => Boolean` (no default; domain
stays infra-free) and rejects `model` outside it with 400 naming `model`. The predicate is owned by
`services.pipelines.OutputConfigValidation` (`lazy val isSelectableModel =
ClaudeModelCatalog.fromEnv().isSelectable`), which is the validator every writer reaches:
`OutputService.validateConfig` (create/update, draft save via `DraftDiff`, patch-set resolve/preview) AND
`PipelineCreatePreflight.validateOutputConfig` (single-call `POST /api/pipelines` with outputs, real and dry) and
`OutputFieldMappingCheck` all call `OutputConfigValidation`. `InsightReadsCheck.check`, the other
`InsightConfig.parse` caller, takes the same required predicate from its callers. Because the parameter has no
default, the compiler finds every caller. Catalog instances elsewhere (`UserPreferenceRepository`, chat) are also
`fromEnv()`, deterministic per process, so they agree. Resolution in the service (mirrors `AssistantModelPolicy`),
BEFORE digest and quota:
- explicit `config.model`: `catalog.select(id)`; `None` (narrowed out since save) writes `failed`, null model, no
  charge, and is not throttled (logged WARN each time). Such a stored id also makes any later config write 400 on
  `model` until it is changed or cleared (same as chat); accepted. Tested at the parse/service level with an injected
  narrowed catalog;
- absent `model`: the server default `ClaudeConfig.model` unconditionally; wire spec `catalog.definition(default)`
  (`None` -> `ClaudeToolRequest.model = None` -> `ClaudeConfig.model`); weight `catalog.weightOf(default)` (1 for a
  non-catalog id such as `claude-opus-4-8`). `InsightModelRequest` gains `model: Option[String]` (the resolved id,
  `None` for a non-catalog default); `ClaudeInsightClient` maps it via `catalog.definition` to
  `ClaudeToolRequest.model` and reports the response's model (`FinalResponse`), WARNing on a mismatch. Request rules
  stay enforced by `ClaudeClient`; a recording-transport test asserts no
  `temperature`/`top_p`/`top_k`/`thinking`/`tool_choice` per catalog model.

**D8 Role-shaped reads (R3).** `OutputInsightReadService` resolves the role with `accessChecker.requireAccess
("pipeline", ...)` (Owner/Editor/Viewer). When the role is Viewer the protocol omits `model`, token counts,
`costMicros`, `runId`, `inputDigest`; status, trigger, citations and markdown stay. The shape spec pins the new
constructor list (still no model client). Fail-first test per role on both routes. R3b: for a Viewer, `skipped_quota` and `skipped_budget` map to `not_updated` in
`lastAttempt` and every history item (a projection in the response layer; the stored status is untouched); owner and
editor see the real status. Schemas add `not_updated` to the status enum. Fail-first test per role on both routes.

**D9 Manual refresh: 202 + poll.** `POST /api/outputs/:id/insight/refresh` in `OutputRoutes`, inside its own
`RateLimitDirective`/`InMemoryRateLimiter` (`INSIGHT_REFRESH_RATE_LIMIT_PER_WINDOW`, default 6, `< 1`/non-numeric
falls back with WARN, window `RATE_LIMIT_WINDOW_SECONDS`), nested in the general `/api` limit. Owner/editor: start the
render asynchronously and return `202 {outputId, started}` (new schema
`schemas/outputs/output-insight-refresh-response.schema.json`); `started` is `false` when a render of that Output is
already in flight in this process (the poller then sees that render's attempt). The client polls `GET /insight`
(`lastAttempt` shows the result). No request waits on the model (Pekko's 20 s timeout is moot). Viewer 403; stranger,
unknown, non-insight 404. Trigger `manual`, run id null, charged to the owner.

**D10 Seam; no migration.** `trait InsightRenderedListener { def onRendered(e: InsightRendered): Unit }`, a listener
list (empty in prod) called in try/catch after an `ok` insert; `latestFor` = `latestOk`. L2 notes: (a) failure reasons
are WARN-logged with ids, not stored; (b) is D8; (c) two-query reads are fine (digest reads `latestOk` only).

**D11 Live check.** One refresh-route render on the lane backend (`start-servers.sh`, HEL-1755 mechanism, key never
read) with `CLAUDE_MODEL=claude-haiku-5-5` and `model = claude-haiku-5-5`; the requested model is logged at INFO
before the send and asserted with the response model; projected cost < $0.50 first.

## Planner Notes

Risks accepted: catch-up latency up to 1 h 15 min; one pinned connection per pass; rare cross-instance double send.
Self-approved: 06:00 UTC; 15-min buckets, 10-render cap; manual bypasses throttle only; throttle writes no row; viewer
keeps status/trigger/citations (R3 names model, tokens, cost; runId/inputDigest dropped as public does; PR names
this); refresh 6/window, 202 + poll; 30 s timeout; absent baseline = zero delta. C12 RED FIRST governs order.

**D13 Fold-ins (owner answer 2026-11-18).** (a) Pin: the refresh route accepts an optional JSON body `{"trigger":
"pin"}` (any other value 400; absent = `manual`); pin renders bypass the throttle like manual and are charged to the
owner. `useAskPin` calls it once after `createOutput` succeeds; a refresh failure is logged and never fails or reverts
the pin. (b) `GET /insight` adds `canRefresh` (owner or editor). (c) Panel: a "Refresh" button when `canRefresh`; it
sets `refreshPending`, POSTs, then polls `GET /insight` every 2 s until `lastAttempt.id` changes or 45 s pass, then
clears. `started: false` just polls. (d) Quota wording: `deriveInsightState` maps `skipped_quota` to the quota note
whenever the server sends it (only owner/editor receive it); wording names no actor ("Daily AI limit reached"),
`skipped_budget` and `not_updated` map to the neutral note. (e) Model selector in `InsightKindFields` after the preset:
options from `GET /api/assistant-models` (`models`), plus "Server default" (writes no `model`, clears a stored one);
a 403 or error hides the selector, never blocks saving. (f) e2e: the CI e2e backend has no API key, so no real trigger
can produce an `ok` render, and a fake model in the production backend is refused. The psql seed stays only for `ok`
states; new e2e covers the real trigger path (refresh -> 202 -> keyless `failed` -> failed state; pin -> one `pin`
attempt). The PR states this.

**D14 Output cap (owner, cycle 2).** `ClaudeInsightClient.MaxOutputTokens` and `InsightLimits.maxOutputTokens` become
4096 (amends D2's 400; thinking and text share it, the first live render returned thinking only). A failed render that
reached the model records its usage and `cost_micros` (the failure carries usage).
