# Tasks — Persist the run truncation signal

## 1. Migration

- [x] 1.1 Immediately before writing the file, derive the next migration number from the tree:
      `ls backend/src/main/resources/db/migration/ | sort -V | tail -3` **and** check every other branch
      (`git branch -a` / the sibling worktrees) for claimed numbers. HEL-955 claims V103. Never edit an applied
      migration — Flyway checksums whole files including comments and this machine shares one `flyway_schema_history`.
- [x] 1.2 Add `pipeline_runs.truncated_reads JSONB NULL` — no `DEFAULT`, no backfill (design Decision 2: NULL is the
      not-recorded state and must stay reachable only by pre-existing rows).
- [x] 1.3 Add `pipelines.last_run_truncated BOOLEAN NULL` — no `DEFAULT`, no backfill (design Decision 3).
- [x] 1.4 Confirm no RLS policy change is needed: `ADD COLUMN` does not alter policies and no new read path is added.
      State the confirmation with evidence rather than assuming it (this repo has RLS defects invisible under a
      superuser-connected local/CI Postgres).

## 2. Persist on write

- [x] 2.1 Extend `PipelineRunRow`/`PipelineRunTable` (`PipelineRunRepository.scala:315-343`) with the new column,
      mapped as an optional JSON value.
- [x] 2.2 Extend `updateRunTerminalInternal` (`PipelineRunRepository.scala:110-117`) to write the truncated reads
      alongside `status`/`completed_at`/`row_count`, in the **same** statement — the two must not be writable apart.
- [x] 2.3 Extend `PipelineRepository.updateLastRun`/`updateLastRunInternal` (`PipelineRepository.scala:457-500`) to
      write `last_run_truncated` in the same statement as `last_run_row_count`.
- [x] 2.4 Thread the reads to the writes. **They are not in scope at the call site as-is:** `onRunSuccess` is invoked
      at `PipelineRunService.scala:894-895`, *before* `truncationFields` is computed at :898-899, and the two writes
      live inside `onUnblockedRunSuccess` (:1011, writing at :1149/:1152). Move the `truncationFields` computation
      above the success branch and thread the reads through the `onRunSuccess`/`onUnblockedRunSuccess` signatures. Do
      **not** recompute them; do not store the notice string (design Decision 1). A successful run always writes a
      non-null value — `[]` when nothing was truncated.
- [x] 2.5 **Dry runs (design Decision 2a).** `insertDryRun`/`insertDryRunInternal`
      (`PipelineRunRepository.scala:124-143`) inserts an already-terminal row in one statement, bypassing
      `updateRunTerminalInternal` entirely, and `listByPipelineInternal` (:211-217) does not filter `dry_run`, so those
      rows render a row count at `RunHistoryModal.tsx:130`. Thread the reads into `onDryRunSuccess`
      (`PipelineRunService.scala:927-949`) — the value is not in scope there today — and persist them on the dry-run
      insert. A dry run must never persist NULL.
- [x] 2.6 **Failure paths (design Decision 2a).** The paths at :216/:219, :868/:871, :996/:999 write `[]`, never NULL —
      or the reads observed before the failure where any were computed. First **verify** that failed runs persist
      `row_count = None`; if any failure path does persist a row count, that path must carry the observed reads
      instead, and the discrepancy is an escalation rather than a judgement call.
- [x] 2.7 After 2.4-2.6, assert the scoped invariant by enumeration: grep every insert/update against
      `pipeline_runs` and confirm each write that produces a **terminal** row populates the column.
      `insertRunInternal` (`PipelineRunRepository.scala:63-82`) is expected and permitted to leave it NULL — it
      inserts a `queued` row whose truncation facts do not exist yet and which persists no row count (design
      Decision 2a). This is a known, decided exception, **not** an escalation. NULL is therefore reachable only by
      rows that predate the migration or have not reached a terminal status.
- [x] 2.8 `SparkJobSubmitter.scala:85` and `:101` also call `updateRunTerminalInternal` with a real row count. They
      are dormant today (nothing calls `submit`), but if the new parameter is added with a default they will silently
      write NULL to a terminal row and break the 2.7 invariant. Make the parameter explicit at those call sites, or
      state in the commit why a default is safe there.

## 3. Read path

- [x] 3.1 Add `RunTruncationRecord(truncated, primaryAvailableRowCount, reads, notice)` to `PipelineProtocol.scala`
      near `TruncatedReadResponse` (:183-188), with a doc comment stating that `truncated` is run-wide and
      `primaryAvailableRowCount` is primary-scoped — matching HEL-890's naming, not the older unqualified name.
- [x] 3.2 Add `truncation: Option[RunTruncationRecord] = None` to `PipelineRunRecord` (:156-167) and bump its
      `jsonFormat10` (:303) accordingly.
- [x] 3.3 In the run-history read path (`PipelineRunHistoryRoutes.scala` / its service), map a NULL column to `None`
      and a non-null column to a present record whose `reads` is always present (empty when complete), deriving
      `truncated = reads.nonEmpty` and recomposing `notice` via `PipelineRunService.composeTruncationNotice`.
      **Do not edit `ApiRoutes.scala`** — a concurrent run owns it.
- [x] 3.4 Add `lastRunTruncated: Option[Boolean]` to `PipelineSummaryResponse` (:100-116) and bump its
      `jsonFormat8` -> `jsonFormat9` at `PipelineProtocol.scala:296` (required to compile — the analogous bump to
      3.2's).
- [x] 3.4a Carry the field through **every** layer it must travel, none of which is a one-line change:
      `PipelineRepository.PipelineSummary` (`PipelineRepository.scala:577-588`), `PipelineRepository.listSummaries`
      (:537), the `toSummaryResponse` mapper, `PipelineService.listSummaries` (`PipelineService.scala:109-110` — a
      two-line delegation, **not** :2234 as an earlier draft claimed), and `PipelineService.findSummaryById` (:113),
      which is what serves the detail page. Verify each line reference against the tree before editing.
- [x] 3.5 No inline fully-qualified names in any Scala touched (CONTRIBUTING.md).

## 4. Contracts (same change, per CLAUDE.md)

- [x] 4.1 Update `schemas/pipelines/pipeline-run-record.schema.json` — it sets `additionalProperties: false` with an
      explicit `required` list, so the new nested object is a required edit. Model the nested `reads` as required and
      the outer `truncation` as optional, so absence means not-recorded at exactly one level.
- [x] 4.2 Update `schemas/workspace/workspace-context.schema.json` for the pipeline-summary shape.
- [x] 4.3 Run the schema-drift and openspec hygiene checks the pre-commit hook runs, and fix rather than bypass.

## 5. Frontend (`frontend/src/features/pipelines/**` only)

- [x] 5.1 Extend the pipeline/run types (`types/output.ts`, `services/pipelineService.ts`) with the new fields,
      modelling not-recorded as a distinct case from complete — not as `truncated: false`.
- [x] 5.2 `PipelineDetailFooter.tsx:104-108`: mark the rows-written figure partial when the persisted signal says
      truncated, using icon+text (never colour alone), per DESIGN.md tokens.
- [x] 5.3 `PipelineDetailPage.tsx:168-180`: render the truncation banner from the **persisted** signal when no live
      run state is present, so a reload shows what the post-run page showed. Do not delete the Redux path; a fresh run
      still supersedes the persisted value.
- [x] 5.4 `RunHistoryModal.tsx:130`: mark a truncated run's row count partial.
- [x] 5.5 `PipelineListTable.tsx:122-124`: mark a truncated `lastRunRowCount` partial.
- [x] 5.6 Render nothing extra for complete **and** for not-recorded (design Decision 4) — no affirmative "complete"
      badge anywhere.
- [x] 5.7 Do not touch `frontend/src/shared/chrome/**` or `DashboardList.css` — a concurrent run owns them.

## 6. Tests — evidence standard

- [x] 6.1 **Verify each new test's red arm can actually fire before trusting it green.** Run the assertion against a
      deliberately wrong value and confirm it fails. A mutation that cannot go red is an instruction to weaken the
      assertion.
- [x] 6.2 Backend: a truncated run persists non-empty reads and reads back as truncated with a notice byte-identical
      to the live run result's notice (assert the string, not merely that one exists).
- [x] 6.3 Backend: a complete run persists `[]`, not NULL, and reads back as recorded-and-not-truncated.
- [x] 6.4 Backend: the at-cap boundary (source exactly at `MaxRunRows`) persists as complete, not truncated — the
      explicit no-false-positives criterion.
- [x] 6.5 Backend: a row with a NULL column reads back as not-recorded (`truncation` absent), and specifically **not**
      as `truncated: false`. Insert the NULL row directly so this exercises the real historical shape.
- [x] 6.6 Frontend: after a reload with **empty** Redux run state, a truncated pipeline's detail page renders the
      partial marker and the notice. Assert on rendered content, not on a status code or a mock call count.
- [x] 6.7 Frontend: a not-recorded pipeline renders no truncation marker and no completeness claim.
- [x] 6.8 Backend: a **dry run** over a truncated source persists a recorded, non-empty signal (design Decision 2a),
      and a failed run persists a recorded signal rather than NULL.
- [x] 6.9 Frontend: `RunHistoryModal` marks a truncated run's count partial and leaves a complete run's unmarked;
      `PipelineListTable` does the same for `lastRunRowCount`. Tasks 5.4/5.5 and two spec scenarios target these
      surfaces, and 6.6/6.7 cover only the detail page.
- [x] 6.10 Assert the truncated marker is **not colour-only** — e.g. that accessible text or an icon with an
      accessible name is present — since the spec forbids relying on colour alone.
- [x] 6.11 Check the fixtures, not just the findings: confirm any pipeline/run fixture used here reflects a shape the
      live API actually returns, and that no test double swallows a failure into a vacuous pass.

## 7. Verification and delivery

- [x] 7.1 Restart the dev servers rather than trusting `start-servers.sh`'s "already healthy … reusing" — that probe
      answers "something is listening", not "your binary is loaded" (CON-155). Verify freshness functionally.
- [x] 7.2 Full gates: `npm run lint`, `npm run typecheck`, `npm test`, `sbt test`, plus the helio-mcp type check
      (CI covers helio-mcp — never write "not covered by CI").
- [x] 7.3 Delete any rows this run created in the shared database and confirm the deletion **by query**, not by the
      delete command's exit status. Report anything the run modified.
- [x] 7.4 Write `files-modified.md` for the delivery squash.
