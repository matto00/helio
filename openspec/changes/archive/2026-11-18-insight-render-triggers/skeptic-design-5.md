## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71. The change directory is untracked planning
artifacts. I read ticket.md, proposal.md, design.md, tasks.md and all four spec deltas, and checked them against
the code on this branch and the main `insight-grounding` spec. Earlier skeptic reports were treated as claims.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/insight-render-triggers/HEL-1743`.
- **Round-4 CR1 (preset) is fixed.** D2 now infers from the insight node's own non-insight Outputs, independent of
  `reads`. It uses ENABLED ops on the primary `parentStepId` chain, root first, through a named helper
  (`InsightNodeSignalsBuilder.parentChainOps`). Test 4.14 covers a read Output on another node. This matches
  `openspec/specs/insight-grounding/spec.md:57-66` and `InsightNodeSignals` (InsightPreset.scala:25).
- **Round-4 CR2 (grounding delta) is fixed.** `specs/insight-grounding/spec.md` MODIFIES "Model call shape" so it
  covers the per-Output model and the catalog request rules. It also relaxes "no test SHALL make a live API call" to
  allow the owner-approved live check. That agrees with D7, D11 and C15.
- **D1 hook.**
  - `publishTerminalAfter` publishes and then returns `Future.fromTry(outcome)` (PipelineRunTerminalWrites.scala:34-42).
  - The succeeded path calls it with `skipPublishOn RunNoLongerOpen` (PipelineRunSucceededWrites.scala:331-334).
  - `updateMeta`, which writes `last_run_*`, is in the chain before the publish (:308-318).
  - A `foreach` on the returned future therefore fires after the publish and never delays it.
  - `SparkJobSubmitter` is not a live execution backend: ApiRoutes.scala:498 passes `executionBackend = null`, so
    every run uses `InProcessExecutionBackend`. No real-run path bypasses the hook.
- **D6.** `AiPipelineQuotaGate.checkAndIncrement(ownerUserId)` (AiPipelineQuotaGate.scala:19, 42-52) calls
  `incrementIfUnderCap`, which already takes `weight: Int = 1` (AssistantDailyUsageRepository.scala:33). The only
  overriding fakes are ClaudeAiStepClientSpec.scala:54 and :62, as D6 states.
- **D7.**
  - The catalog API exists: `definition`, `select`, `isSelectable` and `weightOf` (1 for a non-catalog id), plus
    `fromEnv` (ClaudeModelCatalog.scala:36-47, 77).
  - `ClaudeToolRequest.model: Option[ClaudeModelSpec]` exists (ClaudeModels.scala:189-190).
  - `FinalResponse` carries the API's model as a second parameter list (ClaudeClient.scala:142).
  - Today `ClaudeInsightClient` reports `client.modelId`, not the response model, so task 1.4's change is real and
    needed.
  - `claude-opus-4-8` is not a catalog id, so the spec scenario that rejects it is correct.
  - The `InsightConfig.parse` callers are OutputConfigValidation.scala:81 and InsightReadsCheck.scala:22.
    `InsightReadsCheck.check` is called at OutputService:196, DraftDiff:379 and PipelineCreatePreflight:229, and
    PipelineCreatePreflight:224 goes through `OutputConfigValidation.validate`. A required predicate makes the
    compiler find every caller.
- **D5.**
  - `withSystemContext` = `privilegedDb.run(action.transactionally)` (DbContext.scala:63-64), so a new non-transactional
    pinned-session helper is needed, as task 2.5 says.
  - `runPasses` holds the started-not-awaited retention and deletion passes to copy (PipelineSchedulerService.scala:111-156).
  - The daily test list now includes 06:30, which exercises the once-per-day predicate rather than only the bucket gate.
- **Store (V145).** It supports every status, trigger and nullable column the design writes. The insert takes an
  explicit `createdAt` (OutputInsightRepository.scala:29-37). "Newest" means `created_at DESC, id DESC` for
  `latestAttempt`, `latestOk`, `listRecent` and `purge`. The UPDATE grant exists, so coalescing by UPDATE is
  mechanically possible.
- **Spec, design and tasks agree** on the guard order, the 202 + poll refresh, `started`, the viewer shape (runId and
  inputDigest dropped), the refresh limiter, 06:00 UTC and the 15-minute buckets. Two defects remain, below.

### Verdict: REFUTE

### Change Requests

1. **An on_run render dropped as an in-flight duplicate is never caught up, so the insight can stay stale
   indefinitely.**
   - The spec "Render after a successful real run" says every `on_run` insight SHALL be rendered after each succeeded
     run.
   - D2 drops a second render while one is in flight ("an in-flight duplicate (no row, logged)"). The in-flight entry
     is held until the underlying send completes, which can be up to the transport's 60 s read timeout, past the 30 s
     render timeout.
   - D4 relies on the D5 catch-up for dropped renders. Its predicate is "`last_run_at` newer than the Output's newest
     attempt". The design never says what `createdAt` an attempt row carries, and `insertAction` takes it as a
     parameter. The natural reading, `now` at insert time (the end of the render), breaks this case:
     - Run 1 publishes at t0, and render 1 reads its inputs at about t0.
     - Run 2 succeeds at t0+2 s and writes `last_run_at = t0+2`. Its render is dropped because render 1 is still in
       flight.
     - Render 1 inserts its row at t0+5 s.
     - The catch-up predicate `t0+2 > t0+5` is false, so run 2's data is never rendered. The insight keeps run 1's
       narrative until some later run happens to render.
   - Back-to-back runs are a normal pattern: HEL-1093 dataset-write auto-runs, form submissions, a manual run after a
     scheduled one.

   Required, in D2/D4 and tasks 2.2/4.5:
   - Either (a) state that every attempt row's `created_at` is the instant the render began, captured before its
     inputs are read (the coalescing UPDATE still sets it to now), so the catch-up predicate compares data time with
     data time;
   - or (b) state that an in-flight duplicate marks the Output for one re-render when the in-flight send completes.
   - Add a test: run 2 succeeds while run 1's render is in flight; then either the tick pass (after the throttle
     window) or the re-render produces an attempt over run 2's data.
   - Correct the D2 sentence "One row per outcome except the hourly throttle and an in-flight duplicate", which
     currently implies the catch-up covers both.

2. **Free-tier skip-row coalescing contradicts its own spec scenario and the design's sizing claim.**
   - The "Render guards" requirement coalesces only when "status and digest equal the newest attempt's".
   - A free-tier Output never has an `ok` row, so the digest guard never matches. Every run with changed data has a
     new digest, so it inserts a NEW `skipped_quota` row.
   - The same requirement's scenario says "one `skipped_quota` row exists however many runs occur". D4 says "a
     free-tier pipeline holds one live `skipped_quota` row". Both hold only when the data is identical.
   - Under the requirement as written, a free-tier pipeline driven by dataset-write auto-runs (up to the 10/min run
     rate limit) writes one row per run and keeps them for the 30-day free retention. This is the same store-sizing
     problem round 4 CR3 raised, still open for the largest tier.
   - It also contradicts the purge premise that task 2.6 must re-document (OutputInsightRepository.scala:63-66:
     "volumes are small").

   Required: make the requirement, the scenario and D4 agree on one rule. Either:
   - (a) coalesce `skipped_quota` on status alone: update the newest attempt's `digest` and `created_at` in place
     (one UPDATE by id). Say whether `skipped_budget` gets the same rule.
   - (b) keep digest-keyed coalescing, rewrite the scenario to "identical data", and state the free-tier worst case
     (rows per day and per 30-day retention) in D4, with the purge doc comment matching it.

   Test 4.3 must exercise the chosen rule with CHANGING data across runs, not only identical data.

### Non-blocking notes

- **Coalesced row keeps stale fields.** D4 has a garbled fragment: "...but not digest or quota. A free-tier
  Coalescing (store sizing, ...". It is a leftover splice; fix the prose. Also, a coalesced row keeps its original
  `trigger` and `run_id`. A daily pass that coalesces into yesterday's `on_run` `skipped_unchanged` row then shows
  trigger `on_run` at 06:00. The daily scenario ("exactly one `daily` attempt is recorded") would then fail. Either
  match `trigger` in the coalescing key or update `trigger`/`run_id` with `created_at`. The executor can settle this.
- **Unbounded failure rows.** `failed` rows for an unselectable (narrowed-out) model and for the keyless
  `Unavailable` client are neither throttled (they have a null model) nor coalesced (only `skipped_*` coalesces). Each
  writes one row per run. These cases are rare or dev-only, but say so, or coalesce them too.
- **Model threading.** The model must reach the request through the renderer. `InsightRenderer.attempt` builds
  `InsightModelRequest(system, user, maxOutputTokens)` (InsightRenderer.scala:56), so `prepare`/`send` must carry the
  resolved model, including into the validator retry.
- **Viewer shape.** It is still broader than the public route (status, trigger, citations). The planner
  self-approved it; name it in the PR, as the Planner Notes say.
