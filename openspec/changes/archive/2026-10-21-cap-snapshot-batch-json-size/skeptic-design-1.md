## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed worktree HEAD e88acadb9a833755cf15e6e6b6e49d3ae97f5aa7 (planning artifacts untracked under the change dir).

### What I verified (with evidence)

- **Premise holds.** `NodeSnapshotRepository.scala:134` `SnapshotInsertBatchSize = 200`; `:172-185` renders each batch's
  `compactPrint` lazily inside `DBIO.successful(()).flatMap(_ => insertBatch(batch))`, but the whole batch's strings are
  built together (`batch.map { ... render(row) ... }`), so a 200-row batch of ~280k-char rows holds ~56M chars at once.
  That is consistent with skeptic-final-3's 294 MB real vs 93.6 MB dry. The row-count guard `NodeSnapshotBatchedWriteSpec`
  exists (premise-validation "minor-staleness" is correct).
- **Run and backfill both reach the method:** `PipelineRunSucceededWrites.scala:119,146`; `PipelineRunBackfill.scala:159`
  (`persistBackfilledRows` -> `overwriteRows`).
- **Post-walk check:** `RunLimits.scala:35-41` prices rows as `size + 6` over `Map[String, Any]` frames, with no text term.
  It is called only from `PipelineRunExecutor.scala:256/277` (`refuseOverPostWalkBudget`, `!isDry`).
- **Guard spec pins AC6 at the limit:** `RunLimitsGuardSpec.scala:52-54` asserts `cost(16, Seq(11)) shouldBe 3900000L`
  and `<= MaxPostWalkCells`, and `:64-66` is a tripwire `MaxPostWalkCells <= 3900000L`. HEL-1660 AC6 (ticket.md:47) is an
  owner-accepted "ordinary large pipeline still succeeds".
- **Payload write:** `NodePayloadHistoryRepository.scala:91-92` renders `JsArray(rows).compactPrint` and then measures
  bytes. `PayloadHistoryConfig.scala:70` reads `PAYLOAD_HISTORY_MAX_BYTES` with a floor of 1 and **no ceiling**.
- **Response path:** `PipelineRunExecutor.scala:338` puts the full `jsRows` in `RunResultResponse`. It is declared a
  non-goal.
- D1 (exact length scan), D2 (size-capped batches, at least 1 row, still lazy per batch), the D5 guards and mutations,
  and the D6 shapes are concrete. AC1-AC4 each map to tasks: 1.1/2.7, 1.1, 2.2/2.6 and 2.5. The ~20-row variant's concat
  results (2 x 350k = 700k) stay under the 1,048,576 text cap.

### Owner-ruling coverage of the self-approvals

- **D4 is genuinely covered.** It is a memory-only reordering with an unchanged outcome and WARN, so no ruling is needed.
- **D3 is covered in principle.** It prices a copy ruling 3 already says the post-walk check must price, and it fails
  through the ruled mechanism. That holds only if it refuses nothing that is within the share today. As written it does
  not satisfy that condition (CR1). With CR1 fixed, no owner escalation is needed.

### Verdict: REFUTE

### Change Requests

1. **D3 as specified refuses HEL-1660's owner-accepted AC6 shape.** The term
   `CellWeight.textCells(SnapshotBatchMaxChars + widest) x factor` adds at least `textCells(1,048,576)` = 45,590 cells
   (times the factor) to EVERY run, including narrow ones whose batches render far below 1M chars. The AC6 shape is
   pinned at exactly `MaxPostWalkCells` (`RunLimitsGuardSpec.scala:52-54`), so it would flip to refused. Two things
   forbid the obvious fix: the design says "`MaxPostWalkCells` is unchanged", and the tripwire forbids raising it. The
   executor would then face an escalation with the owner asleep, or a fixture edit. Respecify the term so it is zero for
   any node whose rows fit the batch budget. For example: `textCells(max(0, widestRowChars - SnapshotBatchMaxChars)) x
   factor`, justified because every HEL-1660 measured shape already included one batch render of up to the budget. An
   alternative is the actual largest planned batch's excess over what HEL-1660 measured. State explicitly that
   `RunLimitsGuardSpec`'s AC6 pin and the `post-wide-*` and `post-tall-*` shapes stay accepted unchanged.
2. **D1 and D3 disagree on type.** D1 defines `JsonTextLength` over `JsValue`, but `postWalkCells` sees
   `Map[String, Any]` engine rows (`RunLimits.scala:35`); the JsObject conversion happens later, in
   `PipelineRunExecutor.scala:310` and `PipelineRunSucceededWrites.scala:111`. Specify how the widest row's length is
   computed at post-walk time. One option is a length over engine values that mirrors `PipelineRowJson.anyToJsValue`,
   including Double, Float, BigDecimal, nested Map and the `toString` catch-all. The other is a transient per-row
   conversion. Add an equality case to the D1 spec for whichever path is chosen. Otherwise the two can drift and
   underprice.
3. **Backfill is not covered by D3, but the spec claims it is.** The spec requirement covers "A real run (manual,
   scheduled, hook, auto-run, backfill)" and then states the widest-row refusal. Backfill
   (`PipelineRunBackfill.scala:103-160`) never calls `refuseOverPostWalkBudget`. A single wide row (reachable: many
   compute steps of up to 1M chars each, within the live-cell budget) would still be rendered whole on that path. Decide
   one of two things. (a) Apply the widest-row check in `persistBackfilledRows` and state its failure mode: backfill
   recovers with a log, not a step error. (b) Scope the spec's refusal clause to the executor paths and record backfill's
   remaining exposure. Add a matching task or guard.
4. **Proposal and spec contradict D4.** The proposal says the payload write "stops rendering once it passes", and the
   spec scenario says "rendering stops at the cap". D4 says it measures first and "renders only when within maxBytes",
   which means it never renders an over-cap node. Align the proposal and the spec scenario to D4, for example "an
   over-cap node is never rendered; no payload is stored, a WARN is logged, the summary point is still written".
5. **D4's "(<= 1 MiB by config)" is false.** `PayloadHistoryConfig.scala:70` has no upper bound on
   `PAYLOAD_HISTORY_MAX_BYTES`. Correct the claim: the payload render is bounded by the configured `maxBytes` (default
   1 MiB). Either state that the spec's "within the per-run share" holds at the default and for any value an operator
   keeps under the share, or price the payload render in the post-walk term.

### Non-blocking notes

- The response path (`RunResultResponse(jsRows, ...)`) renders the whole terminal frame at once on a manual HTTP run.
  The 200-row long-text shape will still breach the share there. The non-goal says findings are "reported", but no task
  files the follow-up. Add a task to file a Linear follow-up (relatedTo HEL-1679).
- The 1-row "same total text" variant fails at the concat text cap, so it never reaches the write. The "widest accepted
  single-row shape" is the one that actually exercises CR1/CR3. Size it just under the walk limits so it does.
