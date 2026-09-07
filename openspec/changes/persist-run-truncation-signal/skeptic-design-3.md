## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

All claims read from the live tree (worktree paths), not from the orchestrator's summary.

- **Every `pipeline_runs` write path enumerated.** `grep -n "runsTable"` in
  `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
  yields exactly three mutating statements: `runsTable += row` at :81 (`insertRunInternal`, `status =
  "queued"`, `completedAt = None`, `rowCount = None`), the `.update(...)` at :114-117
  (`updateRunTerminalInternal`), and `runsTable += row` at :142 (`insertDryRunInternal`, `status =
  "dry_run"`, `completedAt = Some(startedAt)`, `rowCount = Some(rowCount)`). Everything else at
  :158/164/184/190/202/213/230/245/257 is a read or a delete. **There is no fourth write path**, so with
  2.2 (terminal update), 2.5 (dry run) and 2.6 (failures) covered, no remaining path produces a
  *terminal* row with a NULL column.
- **Round-2 CR1 resolved coherently in all three artifacts.** design.md Decision 2a now opens "The
  invariant is scoped to **terminal** run rows", names `insertRunInternal (:63-82)` as the NULL-carrying
  non-terminal insert, and states NULL means "either predates this change or never reached a terminal
  status". spec.md's second requirement now reads "This SHALL hold for **every** persisted run row that
  reaches a terminal status after this capability ships", with a matching new scenario ("A non-terminal
  run carries no truncation signal and no row count") and a scoped "A newly recorded complete run is not
  unrecorded" scenario ("**WHEN** any run reaches a terminal status"). tasks.md 2.7 now scopes the
  enumeration to "each write that produces a **terminal** row" and calls `insertRunInternal` "a known,
  decided exception, **not** an escalation". No residual unscoped sentence remains — I grepped design.md
  and spec.md for "every persisted run row written after" and got zero hits.
- **The "non-terminal row displays no row count" premise is true on every surface this change touches.**
  `RunHistoryModal.tsx:130` — `{run.rowCount != null ? \`${run.rowCount.toLocaleString()} rows\` : "—"}`;
  `PipelineDetailFooter.tsx:104-108` — the whole "Rows written" span is behind `lastRunRowCount != null`;
  `PipelineListTable.tsx:122-124` — `pipeline.lastRunRowCount != null ? … : "—"`. A queued row persists
  `rowCount = None` (:78) and `updateLastRun` is only called on terminal transitions, so all three render
  an em-dash / nothing. Decision 2a's justification is factually correct, not merely plausible.
- **Terminal-status vocabulary is consistent.** `PipelineRunRegistry.scala:33` defines
  `TerminalStatuses = Set("succeeded", "failed", "dry_run")`; the three persisted terminal writes use
  exactly `"succeeded"` (PipelineRunService.scala:1152), `"failed"` (:216/:868/:999) and `"dry_run"`
  (repository :135). "Terminal" in the artifacts therefore has a real, single definition in the codebase.
- **Round-1 fixes have not regressed.** Re-derived from the tree: `PipelineSummaryResponse` :100,
  `PipelineRunRecord` :156, `TruncatedReadResponse` :183, `jsonFormat8(PipelineSummaryResponse.apply)`
  :296, `jsonFormat10(PipelineRunRecord.apply)` :303, `PipelineService.listSummaries` :109,
  `findSummaryById` :113, `truncationFields` :120, `composeTruncationNotice` :1276 — every one matches
  what tasks 3.1-3.4a and design.md now say. CR2's spec/Decision-4 contradiction is still resolved
  (requirement 3 reads "SHALL NOT display a truncated count bare … SHALL NOT assert or imply
  completeness", with the explicit no-affirmative-marker paragraph). CR3's failure-path refs
  `:216/:219`, `:868/:871`, `:996/:999` now match the tree exactly (round 2's drift note is fixed), and
  all three pass `rowCount = None`, so the `[]`-never-NULL rule's stated premise holds. Tests 6.8/6.9/6.10
  still present. Decision 1's cost paragraph still names both composer helpers.
- **Migration guidance still correct.** `ls backend/src/main/resources/db/migration | sort -V | tail -2`
  → V102 max on this branch; HEL-955 claims V103; "V104 or higher, re-check before writing" stands.

### Verdict: CONFIRM

The single round-2 change request is genuinely addressed by a scoping edit, and the scoping is coherent
in design.md, spec.md (requirement prose + scenarios) and tasks.md 2.7 simultaneously. The repository
enumeration is now provably complete: no write path leaves a terminal row NULL.

### Non-blocking notes

1. **`SparkJobSubmitter` calls `updateRunTerminalInternal` twice and the plan never names it.**
   `backend/src/main/scala/com/helio/spark/SparkJobSubmitter.scala:85` writes a terminal `succeeded` row
   with `rowCount = Some(rows.size)`, and :101 a terminal `failed` row. If task 2.2 adds the new
   parameter with a default (as `rowCount`/`errorLog` already have), both call sites will silently write
   NULL on a terminal row — the exact hole rounds 1 and 2 found, arriving via a parameter default rather
   than a missed statement. This is **not** blocking because the path is dormant: `submit` has no caller
   (`grep` finds only `runService.submit`; the file's own HEL-417 comment says "this path has no caller in
   the route tree yet (HEL-202, dormant)"), so no such row can be produced today, and `execute` (:127+)
   performs no `pipeline_runs` writes at all. Worth one line in task 2.7 so the executor decides
   deliberately — e.g. "Spark's terminal writes pass `[]` (the Spark path tracks no truncation)".
2. spec.md's non-terminal scenario says "queued or running", but `"running"` is only ever an SSE
   `RunStatusEvent` (PipelineRunService.scala:820) and never a persisted `status` value — the only
   persisted non-terminal status is `"queued"` (repository :73). Harmless over-inclusion; no action needed.
3. Round-2 note 1 still applies and is still unaddressed in the tasks: the owner-scoped wrapper
   `updateRunTerminal` (:86-103) also needs the new parameter. The compiler forces it, so it stays a note.
4. Round-1 notes 2 and 3 (byte-identical assertion is same-process only; the RLS confirmation must be
   evidenced, not assumed) remain correctly reflected in the artifacts.
