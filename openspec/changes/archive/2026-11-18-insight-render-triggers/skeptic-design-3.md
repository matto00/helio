## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71. The change dir holds untracked planning artifacts. I read
ticket.md, proposal.md, design.md, tasks.md and the three spec deltas, and checked each claim against the code on this
branch. I treated round 1 and 2 reports as claims only.

### What I verified (with evidence)

- **D1 hook: sound.** `onUnblockedRunSuccess` returns `publishTerminalAfter(...)` (PipelineRunSucceededWrites.scala:331-334).
  `publishTerminalAfter` returns `Future.fromTry(outcome)` after publishing (PipelineRunTerminalWrites.scala:39-42), so
  a `foreach` on it fires only on success, after the publish, and cannot change the result. A `RunNoLongerOpen` skip is
  a failed future and does not fire. This is the only `succeeded` publish site (grep `RunStatusEvent("succeeded"`).
- **Round-2 CR1 (spec says hash serialized): fixed.** The "Render guards" requirement now excludes the serialized pack
  and any timestamp-derived value. This agrees with D3 and with the 4.4/4.12 mutation.
- **Round-2 CR2 (`model` coverage): fixed, and the coverage claim is true.** `OutputConfigValidation.validate` ->
  `validateInsight` -> `InsightConfig.parse` (OutputConfigValidation.scala:72-81) is reached by `OutputService.validateConfig`
  (create :143, update :247), `DraftDiff` :389-390, patch-set resolve/preview (PatchSetOutputResolvers:146,
  PatchSetPreviewPipelineProjection:28), and `PipelineCreatePreflight.validateOutputConfig` :223-224 (single-call create,
  also used by OutputFieldMappingCheck:20). `InsightReadsCheck.check` :22 is the only other `parse` caller. Adding `model`
  to `InsightConfig.Keys` adds it to `OwnKeys` (InsightConfig.scala:34-36), so the tolerance gate in `validateInsight`
  fires when `model` changes. A required predicate with no default does make the compiler find every caller.
- **Round-2 CR3 (absent model): fixed.** D7 now sends an absent `model` to `ClaudeConfig.model` unconditionally, maps it
  via `catalog.definition`, and weighs it with `weightOf`. `definition`, `select`, `isSelectable` and `weightOf` exist with
  these semantics (ClaudeModelCatalog.scala:36-47). `ClaudeToolRequest.model: Option[ClaudeModelSpec]` exists
  (ClaudeModels.scala:190). `FinalResponse.responseModel` exists (:213-215). `ClaudeInsightClient` today reports
  `client.modelId` (:32), which D7 changes.
- **Round-2 CR4 (refresh schema): fixed.** D9, task 3.3 and the spec agree on `202 {outputId, started}` with a new
  schema file.
- **D4 Unavailable before quota: implementable.** `ApiRoutes` degrades to an `Unavailable` client when `ClaudeConfig` is
  `Left` (:472-479 for AI steps). The insight wiring can do the same and the service can test it by reference.
- **D6: matches the code.** `AiPipelineQuotaGate.checkAndIncrement(ownerUserId)` (:19). `Live` skips owner tier, uses
  `incrementIfUnderCap` for beta and denies free/unknown (:42-61). `incrementIfUnderCap(userId, limit, weight = 1)`
  already exists (AssistantDailyUsageRepository:33). One small error: D6 says both test fakes are in
  `AiPipelineQuotaGateSpec` and `ClaudeAiStepClientSpec`. The overrides are actually the two in ClaudeAiStepClientSpec:54,62.
  `AiPipelineQuotaGateSpec` uses `Live`.
- **D8 role: the mechanism exists.** `requireAccess("pipeline", ...)` returns Owner/Editor/Viewer (OutputService:146-149).
  `findById` is RLS-scoped by `helio_can_access_pipeline` (OutputRepository:139-145), so the readable set and the
  pipeline-role set are the same.
- **D4/D5 timestamps: implementable.** `OutputInsightInsert.createdAt` is written explicitly (OutputInsightRepository:29-38),
  so the service clock drives the throttle and the daily tests.
- **Spec, design and tasks agree** on guard order, null-model rows, 06:00 UTC, the 15-minute bucket, 202 + poll, and the
  role shape.
- **Input assembly and preset inference: REFUTED, see CR1.**
- **D5 pinned-session execution path: REFUTED, see CR2.**

### Verdict: REFUTE

### Change Requests

1. **The render's inputs and preset are not specified, and the default config cannot render correctly without
   them.** D2 says only "assemble inputs via `InsightInputAdapters`/history reads, skipping a dangling `reads.outputs`
   id". Task 2.2 says "inputs (skip dangling reads)". No input assembler exists in the code: `InsightInputs(`,
   `InsightHead(` and `InsightNodeSignals(` have no production caller. L3 explicitly leaves part of the job to this
   leaf. InsightRenderer.scala:34 says "`Auto` is not inferred here (the caller has the node signals); it renders as
   `Summary`." Binding specs this leaf must satisfy:
   - `insight-grounding`, Requirement "Preset inference": when the preset is `auto` (the DEFAULT), it SHALL be inferred
     through `InsightPresetInference.infer(preset, InsightNodeSignals(outputs, columnTypes, stepOps))`.
   - `insight-output-kind`: when `reads.outputs` is absent, the insight reads the other Outputs on its own node. That
     default "is resolved by readers", and this leaf is the first reader.

   An implementer following D2 as written could pass `Auto` straight through, so every default insight renders as
   `Summary` and the grounding spec is violated. They could also read no sibling Outputs when `reads` is absent.

   The windows are also ambiguous. `OutputHistoryService.forOutput(output, config, limit, since)` (:87-98) labels a
   window with the read Output's OWN `compare` token, or `"recent"`, not the insight's `reads.windows` token. It also
   truncates points at `limit`. So "for each window its label" in D3's digest has no defined value, and two
   `reads.windows` over one Output would produce identical labels.

   Required: add to D2, and to task 2.2 or a new task, a precise input recipe:
   - (a) The head: which node snapshot (the insight's own `nodeStepId`/root), which internal read, and the row cap
     (`InsightLimits.maxHeadRows`).
   - (b) The read set: `reads.outputs`, or, when it is absent, the other non-insight Outputs on the insight's node. An
     empty list means none.
   - (c) Compares: each read Output's configured `compare`, through `forOutput` + `fromResolution`.
   - (d) Windows: for each `reads.windows` token x each read Output, `since = now - window`, the `limit` used, and the
     label stored (the `reads.windows` token).
   - (e) Preset: `InsightPresetInference.infer` with `InsightNodeSignals` built from the node's Outputs (kind, config),
     the node schema's column types and the enabled step ops from root to node. Also state whether the digest hashes
     the configured preset or the inferred one.

   Add a test that an `auto` insight on a node with a metric that has a compare renders with the `delta` preset. Add a
   test that an absent `reads.outputs` picks up the node siblings.

2. **D5's pinned-session lock cannot be run the way the code's only privileged entry point runs actions, and the plan
   does not say so.** `DbContext.withSystemContext` is the only way to use the privileged pool, and it ALWAYS wraps the
   action in `.transactionally` (DbContext.scala:63-64). `privilegedDb` is a private constructor parameter (:34) with
   no other accessor. A pass built as `ctx.withSystemContext((lock >> DBIO.from(renders) >> ...).withPinnedSession)`,
   which is the obvious reading of D5, holds one open transaction for the whole pass: up to 10 x 30 s with model calls
   in between. That is an idle-in-transaction session for minutes, and it pins the xmin horizon. D5's "Cost, stated"
   paragraph counts only the held connection and not the open transaction. Neither D5 nor tasks 2.5/2.7 mention a
   DbContext change.

   Required:
   - Specify the execution path in D5. For example, a new `DbContext` method that runs a privileged action with
     `withPinnedSession` and NOT `.transactionally`, with the bypass comment the file's contract requires.
   - Add it to task 2.5.
   - State that the lock's `cleanUp` unlock runs on that same pinned session. Also state the fallback: if the unlock
     statement fails, the connection returns to the pool still holding the session lock until Hikari recycles it
     (`maxLifetime` 30 min, application.conf:132). Accept that or close the connection.
   - Alternatively, explicitly choose and justify the long transaction. Either way, the cost must be written down
     before an implementer meets it.

### Non-blocking notes

- **Stored model narrowed out after save.** `validateInsight` and `InsightReadsCheck` parse the MERGED config whenever
  any insight-owned key or `reads` changes. An insight whose stored `model` was later narrowed out of
  `CLAUDE_SELECTABLE_MODELS` will then return 400 naming `model` on an unrelated `prompt` or `reads` edit, until the
  user clears `model`. That is defensible, but say so in D7. The `reads` rule went the other way on purpose: a dangling
  `reads` is tolerated. Also, D7 does not say which predicate the render service passes to `parse`. It should be
  always-true, followed by `select`, so that a narrowed id produces the planned `failed` row and not a parse error.
- **Test seam for "narrowed out".** `OutputConfigValidation`'s predicate is a `lazy val` over `sys.env`, so route-level
  tests cannot narrow it. Test the spec scenario's narrowed-out case at the `InsightConfig.parse` / predicate level,
  and say so in 4.7.
- **D10 record id.** The spec event carries "the stored record id", but `insertAction` returns `DBIO[Unit]`
  (OutputInsightRepository:29). The insert needs `RETURNING id`. Add a line to 2.6.
- **Cross-instance races.** An `on_run` render on one instance can race the tick pass's catch-up on another for the
  same Output. Catch-up selection sees no row while the render is in flight, so it can send twice. The Risks section
  names only the manual-refresh race. Add this one.
- **Timeout vs in-flight set.** State whether an Output leaves the in-flight set at the timeout or when the
  underlying send settles. Leaving at the timeout allows two concurrent sends for one Output.
- **Throttled candidates and the cap.** Throttled daily candidates count toward the 10-render cap only if the pass
  counts throttles. Say which, so a backlog of throttled Outputs cannot starve due ones.
- **D6 wording.** The two overridden fakes are both in ClaudeAiStepClientSpec (:54, :62), not one in
  AiPipelineQuotaGateSpec.
