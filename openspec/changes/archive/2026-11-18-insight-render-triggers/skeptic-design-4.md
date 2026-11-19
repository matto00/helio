## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at HEAD 374741b68378cc38a0228b586f01e699f31b0a71 (the change dir is untracked planning artifacts). I read
ticket.md, proposal.md, design.md, tasks.md and the three spec deltas, and checked them against the code on this
branch and against the binding main specs `insight-grounding`, `insight-output-kind` and `insight-render-store`.
Earlier skeptic reports were read as claims only.

### What I verified (with evidence)

- **Round-3 CR2 (pinned session): fixed and grounded.** `withSystemContext` is `privilegedDb.run(action.transactionally)`
  (DbContext.scala:63-64), and `privilegedDb` is a private constructor parameter (:34). D5 now adds
  `withSystemPinnedSession` (no transaction), `lock >> DBIO.from(renders) cleanUp unlock` on one pinned session, and
  the unlock-failure fallback. Hikari `maxLifetime = 1800000` (application.conf:86) and privileged `numThreads = 5`
  (:128) match the stated cost. Task 2.5 names the DbContext change.
- **Round-3 CR1 (input recipe): mostly fixed.** Read set, head, compares, windows and preset are now each specified.
  `OutputHistoryService.forOutput(output, config, limit, since)` exists (OutputHistoryService.scala:87). It caps at
  `limit` and filters `since` after the cap. `InsightInputAdapters.fromResolution` labels a window with the compare
  token or `"recent"` (InsightInputAdapters.scala:35). D2 now relabels windows with the `reads.windows` token, which
  removes the ambiguity. `NodeSnapshotRepository.listRows` is privileged (`withSystemContext`, :246) and takes
  `limit`. `Output.node: NodeRef` exists (model.scala:656). The preset part is still unsound: see CR1.
- **D1 hook.** `publishTerminalAfter` returns `Future.fromTry(outcome)` after publishing
  (PipelineRunTerminalWrites.scala:39-42). The succeeded path calls it with `skipPublishOn RunNoLongerOpen`
  (PipelineRunSucceededWrites.scala:331-334). A `foreach` on it fires only after a successful publish. Dry runs take
  `onDryRunSuccess`, which does not reach this call.
- **D4 catch-up source.** `pipelines.last_run_*` is written only by real terminal writes (`writeLastRun`,
  PipelineRunTerminalWrites.scala:76-79; SparkJobSubmitter:88). Preview paths never write it
  (PipelineRunPreview.scala:122-127). So the catch-up cannot fire on a dry run or a preview.
- **D3 digest vs. ten identical runs.** The guard order is digest first, so runs 2-10 never reach the throttle. The
  digest excludes `capturedAt` and `serialized`, collapses repeated window values, and treats an absent baseline the
  same as a zero delta. On identical data it is stable across new history points.
- **D7 model validation coverage.** `OutputConfigValidation` is an object (OutputConfigValidation.scala:18), and its
  `InsightConfig.parse` call (:81) is the shared validator. `InsightReadsCheck.check` callers are OutputService:196,
  DraftDiff:379 and PipelineCreatePreflight:229. A required predicate makes the compiler find every one.
  `ClaudeModelCatalog.fromEnv/select/isSelectable/definition/weightOf` exist with the semantics D7 relies on
  (ClaudeModelCatalog.scala:36-47, 77). `weightOf` returns 1 for a non-catalog id.
- **V145 supports every row the design writes.** Status values `skipped_unchanged/skipped_quota/skipped_budget/failed/ok`,
  trigger values `on_run/daily/manual`, and nullable `run_id/model/input_digest` (V145).
- **D8.** The read service today takes only two repositories (OutputInsightReadService.scala:19-22). The store delta
  correctly rewrites the "Read service has no model client" scenario so an access checker can be added.
  `AccessChecker.requireAccess` exists (AccessChecker.scala:37).
- **Spec, design and tasks agree** on guard order, null-model rows, 06:00 UTC, 15-minute buckets, 202 + poll,
  `started`, the role shape and the refresh limiter.
- **The insight-grounding contract was not updated: see CR1 and CR2. Skip-row volume: see CR3.**

### Verdict: REFUTE

### Change Requests

1. **Preset inference mixes signals from different nodes and departs from the binding grounding spec.**
   `openspec/specs/insight-grounding/spec.md`, Requirement "Preset inference", says `auto` SHALL be inferred "from the
   node's Outputs". The scenario reads "a node carrying a metric with compare...". `InsightNodeSignals` describes ONE
   node (InsightPreset.scala:24-26: "`outputs` are the (kind, config) of the Outputs on the node; `stepOps` are the
   enabled op names from the root to the node").

   D2 instead builds the signals from the **read set**. When `reads.outputs` is present, those Outputs can sit on other
   nodes of the pipeline. They would then be paired with the **insight node's** column types and step ops. Results:
   - A chart on node B has its x field looked up in node A's `columnTypes` (`hasTimeSeriesChart`).
   - A table on node B counts as top-n because node A's last two ops are `sort, limit` (`hasTopNTable`).
   - An explicit `reads.outputs: []` makes every `auto` insight a `summary`, even on a node that carries a metric
     with a compare.

   "Step ops on the path to the node" also leaves two things open:
   - It drops "enabled", which the spec and the type both require.
   - It does not define an order for a join/multi-root node. `hasTopNTable` uses `takeRight(2)`, so order matters.
     `NodeDependencyClosure.closureOf` exists, but it is not named.

   Required, in D2, task 2.2 and test 4.14: either
   - (a) infer from the insight node's own non-insight Outputs, per the spec, independent of `reads`; or
   - (b) keep read-set inference, but add a MODIFIED `insight-grounding` "Preset inference" delta that states it, and
     define how per-node column types and step ops are combined for read Outputs on other nodes.

   In both cases, state "enabled ops only", name the helper that yields the ordered root-to-node op list, and add a
   test where a read Output on another node does not change the inferred preset (or changes it as (b) defines).

2. **Missing contract delta for the per-Output model.** The binding `insight-grounding` Requirement "Model call
   shape" says a render calls the model "using the shared configured model". R1, D7 and the `insight-output-kind`
   delta make the model per-Output, with catalog request rules. No change delta touches `insight-grounding`, so after
   archive the main spec would contradict the shipped behaviour. Required: add a
   `specs/insight-grounding/spec.md` delta (MODIFIED "Model call shape"). It must say:
   - the model is the Output's `model` when set, else the server `CLAUDE_MODEL`;
   - catalog models carry no `temperature`/`top_p`/`top_k`/`thinking`/forced `tool_choice`;
   - the scenario covering it is the 4.7 recording-transport assertion.

   Fold in CR1's delta here if option (b) is chosen.

3. **Writing a skip row on every run breaks the store's documented sizing, and the design does not reconcile it.**
   - D4 and the "Render guards" requirement write a `skipped_unchanged` row on every unchanged run, for every tier.
     They write a `skipped_quota` row on every free-tier run, and D2 writes a `skipped_budget` row on every
     over-budget run.
   - The shipped purge is built on the opposite premise. Its doc reads "One DELETE: volumes are small (at most one
     on_run render per Output per hour plus daily/manual)" (OutputInsightRepository.scala:63-66).
   - Retention keeps rows 30/90/365 days by tier (OutputHistoryRetentionConfig.scala:65-67). A pipeline running near
     the 10/min run rate limit, or on frequent dataset-write auto-runs, would keep roughly 14k rows per insight per
     day, and owner tier holds them for a year.
   - Every one of those rows also crowds `/insight/history` (default 30), so real attempts scroll out of view.

   D4 says only "retention bounds it", and only for free tier. Required, choose and document one:
   - (a) Coalesce: do not write a skip row when the newest attempt already has the same status and digest. If you do
     this, the D4/D5 catch-up predicate ("`last_run_at` newer than the newest attempt") must change, or it will
     re-select unchanged insights in every bucket forever. Update test 4.4's "nine `skipped_unchanged` rows" to match.
   - (b) Keep a row per run. State the worst-case rows per insight per day and per retention window. Update the purge
     premise (doc comment, and batching if the single DELETE is no longer sound). Say why `/history` stays useful.

   Either way, put the decision in design.md and make the spec's row-writing text match it.

### Non-blocking notes

- **Head fields.** `InsightHead` needs `outputId` and `capturedAt` (InsightInputs.scala:10), but `listRows` returns
  neither. State that `outputId` is the insight's own id and where `capturedAt` comes from (for example the run's
  terminal time or the newest history point). Pass `limit = Some(InsightLimits.maxHeadRows)` to `listRows` rather
  than reading the whole node and truncating in the builder. Also say whether the digest covers all rows or only the
  head rows; with a limit they are the same.
- **Viewer shape.** R3 says a viewer gets "the reduced shape, like the public route". D8 still gives viewers
  `status`, `trigger`, `lastAttempt` and cited Output ids, which the public route withholds. The planner self-approved
  this. It is defensible because a viewer can read the pipeline anyway, but name it in the PR so the owner sees it.
- **Daily test 06:10.** "06:10 none" is in the same 15-minute bucket as 06:00, so it exercises the bucket gate, not
  the once-per-day predicate. Add a tick in a later bucket of the same day (for example 06:30 -> none).
- **In-flight release** relies on the transport's own timeouts (HttpClaudeTransport.scala:37-38, 148: 10 s connect,
  60 s idle and read), so a hung send does eventually release the Output. Mention it so a future transport change
  keeps it true.
