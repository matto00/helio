## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Every claim below was read from the live tree, not from the orchestrator's summary.

- **CR4 (line references) — FIXED and true.** `PipelineService.listSummaries` is at
  PipelineService.scala:**109**, `findSummaryById` at :**113** (grep `def listSummaries|def findSummaryById`);
  task 3.4a now says 109-110 and explicitly retracts `:2234`. `PipelineRepository.listSummaries` :537,
  `PipelineSummary` :577-588, `updateLastRun` :457-471 / `updateLastRunInternal` :488-500 all confirmed.
  `jsonFormat8(PipelineSummaryResponse.apply)` is at PipelineProtocol.scala:**296** and
  `jsonFormat10(PipelineRunRecord.apply)` at :**303** — both bumps are now named (3.2, 3.4).
  `PipelineSummaryResponse` :100-116, `PipelineRunRecord` :156-167, `TruncatedReadResponse` :183-188 confirmed.
- **CR1 (dry runs) — FIXED, and Decision 2a's code claims are accurate.**
  `insertDryRun`/`insertDryRunInternal` are at PipelineRunRepository.scala:124-143 and build the terminal row
  (`status = "dry_run"`, `completedAt = Some(startedAt)`, `rowCount = Some(rowCount)`) in one `runsTable += row`
  at :142 — it does bypass `updateRunTerminalInternal` (:106-118). `listByPipelineInternal` (:211-217) applies
  no status filter, confirmed. `onDryRunSuccess` is at PipelineRunService.scala:927-949 and its parameter list
  carries no truncation value, while `truncationFields` is computed at :897-899 *after* the `followUp` branch at
  :893-895 — so task 2.5's "the value is not in scope there today, thread it into the callback" is literally correct.
- **CR3 (failure paths) — FIXED, and its premise checks out.** All three failure writes pass
  `rowCount = None`: :216/:219 (insertRun → updateRunTerminal "failed" / updateLastRun), :866/:869, :996/:999
  (design/tasks cite :868/:871 and :996/:999 — within a line or two, close enough to navigate). So Decision 2a's
  `[]`-never-NULL rule is coherent and its "verify failed runs persist row_count = None" instruction will pass.
- **CR5 (task 2.4) — FIXED and accurate.** `onRunSuccess` is invoked at :895, `truncationFields` at :897-899,
  the writes are in `onUnblockedRunSuccess` (:1011) at :1149 (`updateLastRun`) / :1152 (`updateRunTerminal`).
  Task 2.4 now states the computation must move above the success branch and thread through both signatures.
- **CR2 (spec vs Decision 4) — FIXED.** Requirement 3 now reads "SHALL NOT display a truncated count bare, and
  SHALL NOT assert or imply completeness…", with an explicit paragraph permitting no affirmative marker for
  complete or unrecorded. That is exactly what Decision 4 does. No remaining contradiction.
- **CR6 (test gaps) — FIXED.** 6.8 (dry run + failed run), 6.9 (RunHistoryModal + PipelineListTable), 6.10
  (not colour-only) added and each names a concrete assertion, not a topic.
- **Non-blocking note 1 — FIXED.** Decision 1's cost paragraph now names `truncationReadClause` (:1261-1269)
  and `truncationConsequenceSentence` (:1256-1259) and says the whole sentence is regenerated. Verified against
  the composer at :1256-1279.
- **Migration guidance** unchanged and still correct (V102 max on this branch, V103 claimed by HEL-955).

### Verdict: REFUTE

One change request. The six round-1 CRs are all genuinely addressed; this is a *new* instance of the same
invariant hole CR1 found, in the one remaining `pipeline_runs` write path the revision did not enumerate.

### Change Requests

1. **`insertRun` is a third write path that leaves the column NULL, so the invariant is still literally
   false — and task 2.7 will trip over it mid-execution.**
   `PipelineRunRepository.insertRunInternal` (:63-82) inserts every real run's row up front with
   `status = "queued"`, `completedAt = None`, `rowCount = None`, and — after this change — `truncated_reads`
   NULL. That row is only populated later by `updateRunTerminalInternal`. A run that never reaches a terminal
   update (process death mid-run, an abandoned in-flight run) keeps NULL forever, and
   `listByPipelineInternal` (:211-217) filters no status, so it reaches `history` (:725-752) and reads back as
   *not recorded* — falsifying spec.md's new sentence "This SHALL hold for **every** persisted run row written
   after this capability ships" and tasks.md 2.7's "NULL must be reachable only by rows that predate the
   migration". As written, 2.7's enumeration will find `insertRun` and, per 2.6's precedent, the executor is
   told a discrepancy is an escalation — i.e. the plan defers a decision it can make now, which is exactly
   round-1 CR3.
   The severity is genuinely lower than the dry-run case (a queued/failed-to-terminate row persists
   `rowCount = None`, so no bare number is ever displayed for it), so the fix should be a scoping edit, not new
   plumbing. Required: **decide it in design.md Decision 2a and scope the spec sentence and task 2.7 to
   *terminal* run rows** — e.g. "every run row that reaches a terminal status after this ships carries a
   non-null signal; a non-terminal (`queued`/`running`) row carries NULL because its truncation facts do not
   exist yet, and it is distinguished by `status`, not by the truncation column". Then task 2.7's enumeration
   has a rule it can actually pass, and readers know NULL means *either* pre-migration *or* non-terminal.

### Non-blocking notes

1. Task 2.2 names only `updateRunTerminalInternal` (:106-118), but the callers in `PipelineRunService` all go
   through the owner-scoped wrapper `updateRunTerminal` (:86-103), which delegates to it. That wrapper's
   signature also needs the new parameter. The compiler will force this, so it is a note, not a blocker —
   but naming it saves a round trip.
2. Decision 2a's failure-path line refs are `:868/:871`; the actual `updateRunTerminal`/`updateLastRun` pair in
   that block is at `:866/:869`. Harmless drift, but 3.4a's own instruction ("verify each line reference against
   the tree before editing") should be applied to design.md's refs too.
3. Round-1 notes 2 and 3 (the byte-identical assertion is same-process only; the RLS caution must be confirmed
   not assumed) still stand and are still correctly reflected in the artifacts.
