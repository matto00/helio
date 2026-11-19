## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71 (the change dir holds untracked planning artifacts). I
judged ticket.md, proposal.md, design.md, tasks.md and the three spec deltas against the code. I did not rely on
round 1's narrative.

### What I verified (with evidence)

- **D1 hook: sound.** `onUnblockedRunSuccess` returns `publishTerminalAfter(..., writesChain(), skipPublishOn =
  RunNoLongerOpen)` (PipelineRunSucceededWrites.scala:331-334). A `foreach` on that future can neither delay the
  publish nor change the result. The dry-run path is `PipelineRunTerminalWrites.onDryRunSuccess` (lines 145-183). It
  publishes `dry_run` and never writes `pipelines.last_run_*`, so neither the hook nor the D4 catch-up (keyed on
  `last_run_status='succeeded'`) can fire for a dry run.
- **D3 digest (design text): sound.** The fields D3 names exist on the input types without their timestamps:
  `InsightHead.columns/rows`, `InsightCompare.current/delta`, and `InsightWindow.points` values
  (InsightInputs.scala:10-28). The timestamps come in through `InsightInputAdapters.fromResolution` (lines 31-34) and
  can be left out. The run-1 to run-2 baseline transition (absent baseline = zero delta = `flat`) is stated.
- **D4 rows and model: implementable.** V145 allows `model` NULL on any status and has `skipped_unchanged` /
  `skipped_quota` / `skipped_budget` / `failed`. Trigger `on_run` with `run_id` NULL is allowed (V145 comment: run_id
  NULL for renders not tied to a run). `InsightModelFailure.Unavailable` is the no-key client (InsightModelClient.scala
  45-49) and makes no send.
- **D5 lock: sound in principle.** `withPinnedSession` is not used anywhere in `backend/src/main` today (grep). Slick
  provides it, so this is a new pattern rather than a copied one, and the occupancy cost is stated. The privileged
  pool is `maximumPoolSize = 5` (application.conf:129), as D5 says. The aligned 15-minute bucket fixes the
  05:59/06:00 problem: 05:59 is bucket 05:45, and 06:00 and 06:10 share bucket 06:00.
- **D6 weight seam: matches the code.** The trait has the single `checkAndIncrement(ownerUserId)`
  (AiPipelineQuotaGate.scala:20). Test overrides are at ClaudeAiStepClientSpec.scala:54, 62. Free tier and an unknown
  owner are denied (lines 57-60).
- **D8 role: the mechanism exists.** `accessChecker.requireAccess("pipeline", ...)` returns Owner/Editor/Viewer
  (OutputService.scala:146-149). `OutputInsightReadService` today takes only the two repos (lines 19-22), so the
  shape spec must change. D8 says it will.
- **D9: no request waits on the model.** 202 plus polling makes the 20 s Pekko default irrelevant.
- **Spec vs design consistency: REFUTED, see CR1.**
- **Model validation coverage: REFUTED, see CR2.** The premise that `OutputService.validateConfig` is "the one path"
  is false in the code.
- **Absent-model resolution: REFUTED, see CR3.** `ClaudeModelCatalog.select` returns `None` for any id that is not
  currently selectable (ClaudeModelCatalog.scala:40). The code's `ClaudeConfig.DefaultModel` is `claude-opus-4-8`
  (ClaudeConfig.scala:37), which is not a catalog id.

### Verdict: REFUTE

### Change Requests

1. **The spec delta tells the implementer to hash the serialized pack, which is the exact defect D3 fixes.**
   `specs/insight-render-triggers/spec.md`, Requirement "Render guards", says: "The input digest SHALL cover the
   serialized grounding pack, preset, prompt, ...". D3 says the digest "never hashes `InsightPack.serialized`". Task
   4.12/4.4 makes "hashing serialized" the mutation that must turn the test red. `InsightPack.serialized` contains
   `head.capturedAt` and the citation `capturedAt` values (InsightContextBuilder), which change on every run. An
   implementation that follows the binding spec would send on every identical run, and a test written to the spec
   would contradict the planned mutation.
   - Delete "the serialized grounding pack," from the requirement.
   - State positively that the digest SHALL NOT include `InsightPack.serialized` or any value derived from a
     timestamp. This keeps D3, the spec and test 4.4 in agreement.

2. **`model` validation misses the single-call pipeline create path, because D7's premise is wrong.** D7 says the
   static `OutputService.validateConfig` is "the one path draft save, patch-set resolve/preview and create/update all
   use", and puts the catalog there. In the code, `POST /api/pipelines` with outputs does not go through it:
   - `PipelineCreateTransaction.scala:187` and `PipelineCreateDryRun.scala:70` call
     `PipelineCreatePreflight.checkOutput`.
   - `checkOutput` calls `validateOutputConfig` (PipelineCreatePreflight.scala:216, 223).
   - `validateOutputConfig` calls `OutputConfigValidation.validate` directly (line 224).
   - So does `OutputFieldMappingCheck.scala:20`.

   Insight Outputs are creatable on that path: `InsightReadsCheck` is invoked there, and `KnownKeys` maps
   `OutputKind.Insight -> InsightConfig.Keys` (OutputConfigValidation.scala:30). `InsightReadsCheck.check`
   (InsightReadsCheck.scala:22) is a second `InsightConfig.parse` caller, and it needs the predicate too. If the new
   parameter gets a permissive default anywhere, these paths silently store any `model` string. Required:
   - Put the is-selectable predicate where every writer reaches it: `OutputConfigValidation.validate` /
     `validateInsight`, or a catalog val that the object itself owns. Do not use a permissive default parameter.
   - Correct D7's "one path" sentence and task 1.2.
   - Add "single-call pipeline create (`POST /api/pipelines` with outputs)" to the spec scenario "Model outside the
     catalog rejected".
   - Add to task 4.7 a test that creates a pipeline with an insight Output with `model: "claude-opus-4-8"` and gets
     400 naming `model`.

3. **Absent `model` must not be routed through `catalog.select`.** D7 resolves
   `catalog.select(config.model.getOrElse(serverDefault))` and writes `failed` when that is `None`. `select` only
   accepts currently selectable ids. The server default is `CLAUDE_MODEL`: the code default is `claude-opus-4-8`, not
   a catalog id, and the catalog scaladoc says the server default may be narrowed out of `CLAUDE_SELECTABLE_MODELS`.
   So every insight without a `model` key would render `failed` in dev, in CI and in any narrowed environment. That
   contradicts R1 ("absent means the server default `CLAUDE_MODEL`") and D7's own next sentence ("weight via
   `weightOf`, 1 for a non-catalog id"), which could never apply. Required:
   - Mirror `AssistantModelPolicy`:
     - An explicit `config.model` goes through `select`. If it is unselectable, write `failed` with null model and no
       charge.
     - An absent `model` uses `serverDefault` unconditionally. The wire spec is `catalog.definition(serverDefault)`;
       `None` means `ClaudeToolRequest.model = None` and therefore `ClaudeConfig.model`. The weight is
       `weightOf(serverDefault)`.
   - Add to 4.7 a test that an absent `model` with a non-catalog server default, and with a catalog default narrowed
     out of the selectable set, renders `ok` and is charged the expected weight.

4. **The refresh response schema is ambiguous.** Task 3.3 says "refresh response (reuse insight response schema)". D9
   and the spec define the 202 body as `{outputId, accepted: true}`, which is not the insight read shape
   `{render, lastAttempt}`. Pick one and make task 3.3 name a new `insight-refresh-response` schema for D9's body, or
   change D9.

### Non-blocking notes

- D4's first sentence ("every row written after the service invoked the model client records the requested model")
  conflicts with its own null-model list, which includes `Unavailable`. `Unavailable` is returned by invoking the
  client. Say "every row except `Unavailable`".
- Quota is charged before the send, so a beta owner on a backend wired with `InsightModelClient.Unavailable` (no API
  key) is charged on every on_run render. `Unavailable` rows have null model, so nothing throttles this. Consider
  skipping the quota charge when the client is the `Unavailable` default, or state the behaviour.
- Test 4.4: renders are asynchronous after each run. If the test does not wait for each render to settle before
  starting the next run, the in-flight set drops duplicates with no row, and "nine `skipped_unchanged` rows" becomes
  flaky. Await the render, for example through the listener seam or by polling the row count, between runs.
- A manual refresh that lands while an automatic render of the same Output is in flight is dropped with no row. The
  202 still says `accepted: true`, so the poller sees no new attempt. Consider returning a distinguishable field, or
  document it.
- "One catalog instance" (D7/2.7): `UserPreferenceRepository` and `UserPreferencesRoutes` already default to their
  own `ClaudeModelCatalog.fromEnv()`. That is harmless, because fromEnv is deterministic per process, but the claim
  is aspirational.
