## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **File-level claims, read against the live tree.** Accurate: `truncationFields`
  (PipelineRunService.scala:120-141), run call site (:898-905), `composeTruncationNotice` (:1276),
  `PipelineRunRow`/`PipelineRunTable` (PipelineRunRepository.scala:315-343),
  `updateRunTerminalInternal` (:106-118, tasks say 110-117 — close enough),
  `PipelineRepository.updateLastRun` (:457-484) / `updateLastRunInternal` (:488),
  `PipelineRunRecord` (PipelineProtocol.scala:156-167), `jsonFormat10` (:303),
  `TruncatedReadResponse` (:183-188), `PipelineSummaryResponse` (:100-116),
  `PipelineDetailFooter.tsx:104-108`, `RunHistoryModal.tsx:130`, `PipelineListTable.tsx:122-124`.
  Inaccurate: task 3.4's `PipelineService.listSummaries (:2234)` — see CR4.
- **Migration numbering.** `ls backend/src/main/resources/db/migration | sort -V | tail` → V102 max on
  this branch; `git log --all --diff-filter=A --name-only` shows `V103__pending_connectors.sql` added by
  f4d2e184 (HEL-955). **V104+ guidance is correctly derived.**
- **Concurrency.** None of `ApiRoutes.scala`, `Connector*`, `RestApiConnectorDriver`,
  `ConnectorRepository`, `helio-mcp/src/{types,helioApi}.ts`, `frontend/src/shared/chrome/**`,
  `DashboardList.css` is in the plan's impact set. I checked whether the schema-drift gate would
  *force* a forbidden edit: `scripts/check-schema-drift.mjs` reads only `helio-mcp/src/tools/proposal.ts`
  and `proposalValidation.ts` (:26,:31), never `types.ts`, so it does not. Constraint holds.
- **Decision 2 vs HEL-890.** Sound as stated: `[]` for recorded-complete honours present-and-empty
  *within* a recorded run; NULL is reserved for pre-existing rows, and deriving the boolean from
  `reads.nonEmpty` mirrors what `truncationFields` already does at :136. No contradiction — **but the
  invariant it rests on ("a run recorded after this ships is never NULL") is broken by the plan itself,
  see CR1/CR3.**
- **Decision 1 cost.** Real and correctly directed; slightly understated (see note 1). The composer at
  :1261-1277 interpolates the cap into both branches of the clause; persisted rowsRead/availableRowCount
  are verbatim, so only wording is regenerated. Choice is defensible.
- **Decision 4 honesty.** Not honest against this change's own spec delta — see CR2.
- **Tests (section 6).** Largely real evidence, not evidence-shaped: 6.1 requires a red arm, 6.5 inserts
  a NULL row directly, 6.4 covers the at-cap boundary, 6.6 asserts rendered content with empty Redux.
  Gaps in CR6.

### Verdict: REFUTE

### Change Requests

1. **Dry runs are unhandled and break the plan's central invariant.**
   `PipelineRunRepository.insertDryRun`/`insertDryRunInternal` (:124-143) inserts a *terminal*
   `pipeline_runs` row (`status = "dry_run"`, `completedAt` set, real `rowCount`) and never passes
   through `updateRunTerminalInternal`, which is the only write task 2.2 extends.
   `listByPipelineInternal` (:211-217) does **not** filter `dry_run`, so those rows reach
   `PipelineRunService.history` (:725-752) and render at `RunHistoryModal.tsx:130`. A dry run executes
   through the same engine and the same `MaxRunRows` cap, so it can be truncated. Under the plan its
   `truncated_reads` is NULL → read as *not recorded*, which (a) contradicts spec.md's
   "A recorded run SHALL always carry present, non-null truncation detail… the unrecorded state
   unambiguously means 'this run predates recording'", and (b) re-creates the ticket's defect on a
   surface the ACs cover. Note the value is not even in scope at `onDryRunSuccess`
   (PipelineRunService.scala:927-949) — `truncationFields` runs at :898 in `executeRun` — so plumbing is
   required, not a one-line add. Either cover the dry-run write path in design.md + tasks.md, or
   explicitly carve dry runs out and amend the spec sentence so it is not falsified on day one.

2. **spec.md requirement 3 contradicts design Decision 4.** The requirement says every surface "SHALL
   display, in the same place, whether that count is partial, complete, or of unrecorded completeness";
   Decision 4 says "the distinction between complete and not-recorded is therefore not visible in the
   default view". An executor cannot satisfy both. The scenarios are consistent with Decision 4, so the
   cheapest correct fix is to weaken the requirement prose to what is actually intended and defensible
   ("SHALL NOT display a truncated count bare, and SHALL NOT assert completeness for an unrecorded run").
   Decision 4's reasoning is otherwise sound and I do not object to rendering nothing for not-recorded —
   the objection is that the spec currently forbids it.

3. **Task 2.5 defers a decision the spec already fixes.** It permits the executor to "leave the column
   NULL" on the failure paths (:216/:219, :868/:871, :996/:999). A failed run written *after* this ships
   with NULL lands in the not-recorded state — same contradiction as CR1. Decide it in design.md
   (recommend: failed runs write `[]` or the reads observed before failure, never NULL) rather than
   leaving it to execution.

4. **Task 3.4's file claims are wrong and its layer coverage is incomplete.**
   `PipelineService.listSummaries` is at PipelineService.scala:**109-110**, not `:2234` (the file is 2376
   lines; nothing relevant is at 2234). It is a two-line delegation to
   `pipelineRepo.listSummaries` + `toSummaryResponse`, so the new field must also travel through
   `PipelineRepository.PipelineSummary` (PipelineRepository.scala:577-588),
   `PipelineRepository.listSummaries` (:537), the `toSummaryResponse` mapper, and
   `PipelineService.findSummaryById` (:113) which serves the detail page — none of which the tasks name.
   Also: task 3.2 bumps `jsonFormat10` for `PipelineRunRecord` but omits the matching
   `jsonFormat8` → `jsonFormat9` bump for `PipelineSummaryResponse` (PipelineProtocol.scala:296), which
   the added field requires to compile.

5. **Task 2.4's "already-computed" is not true at the call site.** `onRunSuccess` is invoked at
   PipelineRunService.scala:894-895, *before* `truncationFields` is computed at :898-899, and the two
   writes live inside `onUnblockedRunSuccess` (:1011, writes at :1149/:1152). State explicitly that the
   `truncationFields` computation moves above the success branch and that the reads thread through the
   `onRunSuccess`/`onUnblockedRunSuccess` signatures; as written the task reads as if the value were
   already in scope.

6. **Test coverage gaps in section 6.** Add: (a) a dry-run case once CR1 is resolved; (b) frontend
   assertions for `RunHistoryModal` and `PipelineListTable` — 6.6/6.7 only cover the detail page, yet
   tasks 5.4/5.5 and two spec scenarios ("the run history list distinguishes truncated runs",
   "a complete run shows no truncation indication anywhere") target those surfaces; (c) an assertion
   that the marker is not colour-only (spec requires it), e.g. accessible text present.

### Non-blocking notes

1. Decision 1's stated cost is slightly narrower than the real one: recomposition regenerates the
   *whole* sentence (`truncationReadClause` :1261-1269 plus `truncationConsequenceSentence` :1256-1259),
   not only the cap token, so any future wording edit rewrites every historical run's notice
   retroactively. The persisted numbers are unaffected. This does not change the verdict on the decision —
   it is still the better of the two options — but say it accurately.
2. spec.md's "byte-identical to the notice the live run returned" is testable now and a good assertion
   (6.2), but is a same-process comparison, not a durable property across composer edits. Fine as an
   acceptance scenario; do not read it as a guarantee about old rows.
3. Design's RLS caution (executor must *confirm*, not assume, that `ADD COLUMN` needs no policy change)
   is correctly stated and matches this repo's documented history. Keep it.
