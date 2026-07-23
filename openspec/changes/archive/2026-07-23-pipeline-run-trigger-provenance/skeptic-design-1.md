## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Migration numbering**: `ls backend/src/main/resources/db/migration | sort -V | tail` shows
  `V62__pipeline_schedules.sql` is the latest; `V63` (proposal/design/tasks) is correctly the next
  available number. `V28__*.sql` content confirms the drop/re-add CHECK pattern design.md cites is
  real (design proposes a simpler single-statement `ADD COLUMN ... DEFAULT ... CHECK`, which is
  a valid and simpler variant since there's no existing constraint to drop).

- **`PipelineRunRecord` current arity**: `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala:33-41,69`
  — case class has exactly 7 fields (`id, pipelineId, status, startedAt, completedAt, rowCount,
  errorLog`), format is `jsonFormat7`. Confirms design/tasks' claimed `jsonFormat7 → jsonFormat8`
  transition is accurate.

- **All four insert paths** in `PipelineRunRepository.scala` (`insertRun` L38, `insertRunInternal`
  L45, `insertDryRun` L96, `insertDryRunInternal` L103) construct `PipelineRunRow` — grepped for
  every `PipelineRunRow(` construction site in `backend/src/main` and found only these two
  (`insertRunInternal`, `insertDryRunInternal`); tasks 2.1/2.2 cover both. No other construction
  sites (DemoData, raw SQL) touch `pipeline_runs` — grepped all `pipeline_runs` references in
  `backend/src/main`, only `PipelineRunRepository.scala` and `PipelineRunService.scala` (plus two
  unrelated comments) reference the table.

- **`submit()` call chain**: `PipelineRunService.scala` — `submit` (L72) → `runPipeline` (L87) →
  `executeRun` (L224) → `insertRun`/`insertDryRun` (L241, L301) — exactly matches design's proposed
  threading path (submit → runPipeline → executeRun → insertRun/insertDryRun) and Decision 2's
  default-parameter strategy is sound: `submit`'s signature today is
  `(pipelineId, isDry, user)` with no trigger-source param, so a defaulted new parameter is
  non-breaking for the one existing manual callsite.

- **Both `submit()` callsites** confirmed by grep: `PipelineRunSubmitRoutes.scala:27` (manual,
  no new arg needed — default applies) and `PipelineSchedulerService.scala:113` (scheduler `fire`,
  needs the explicit `triggerSource = "scheduled"` arg per task 2.4). No third callsite exists.

- **`PipelineRunHistoryRoutes.scala`** is a thin pass-through (`ServiceResponse.run(runService.history(...))(identity)`)
  — confirms proposal's "unchanged route, richer payload" claim; the new field flows automatically
  once `PipelineRunService.history` (L178-200) populates it from `PipelineRunRow.triggerSource`
  (task 2.5).

- **Frontend `PipelineRunRecord` TS type** (`pipelineStep.ts:300-308`) currently has the same 7
  fields as the Scala case class — task 4.1's additive `triggerSource` union field is accurate and
  parallel.

- **`fetchRunHistory`** (`pipelineService.ts:110-115`) currently does no normalization — task 4.3's
  plan to add a defensive default at this boundary is consistent with the HEL-416
  spray-json-omits-None precedent cited in the ticket, though since the ticket's own guidance
  (and design Decision 3) makes `triggerSource` `NOT NULL` server-side (never `Option`/`None`),
  this defensive normalization is belt-and-suspenders rather than strictly required — reasonable,
  not a flaw.

- **`RunHistoryModal.tsx`/`.css`**: confirmed existing `StatusBadge` pattern (L17-31) and CSS badge
  convention (`.run-history-modal__status`, `--succeeded`/`--failed`/`--running`/`--dry_run`
  variants, all using `--app-*`/`--text-*` design tokens) — task 4.2's plan to add a sibling
  provenance badge following this exact pattern is architecturally consistent with DESIGN.md token
  usage.

- **Schema convention precedent**: `schemas/pipeline-schedule.schema.json` exists, confirming
  Decision 4's claim that a full-object schema (not a delta/patch) is the established sibling
  convention for a previously undocumented response shape.

- **OpenSpec delta correctness**: `openspec/specs/pipeline-scheduler-runtime/spec.md`'s existing
  `### Requirement: Due schedules fire runs through the existing run-submission path` heading text
  matches verbatim the `MODIFIED Requirements` heading in the change's delta spec — required for
  openspec's diffing convention. Ran `npx openspec validate pipeline-run-trigger-provenance --strict`
  → `Change 'pipeline-run-trigger-provenance' is valid`. No existing `pipeline-run-provenance`
  capability collides with the new one (`find openspec/specs -maxdepth 1 -iname
  pipeline-run-provenance` → empty).

- **Test-file anchors exist**: `PipelineRunRepositorySpec.scala` and `PipelineSchedulerServiceSpec.scala`
  exist for tasks 5.1/5.3; `PipelineRunRoutesSpec.scala` exists and already constructs
  `PipelineRunService` for task 5.2's service/route-level test. No dead-end test references.

- **Acceptance criteria traced to tasks**:
  1. Persisted trigger source per path → tasks 2.2-2.4, tested 5.1/5.3.
  2. API + UI show provenance → tasks 2.5, 4.1, 4.2.
  3. Migration clean fresh/existing, defaults to manual → task 1.1, tested 5.4; `NOT NULL DEFAULT`
     single-statement approach is correct for Postgres 11+ fast-default backfill.
  4. schemas/openspec updated + tests → task 3.1, spec deltas, tasks 5.1-5.5.
  5. Backward compatible → Decision 2 (defaulted param) + Decision 3 (additive column with
     default) + additive response field, all verified against real signatures above.

### Verdict: CONFIRM

Design is accurate against the current codebase (migration numbering, case-class arities, exact
call chains and both callsites, all four repository insert paths, route pass-through behavior,
frontend type/component patterns, and schema/openspec conventions all checked and correct), the
plan traces cleanly to every acceptance criterion, is proportionate in scope (correctly rejects a
new domain sum type per the existing `status: String` precedent), and does not miss any call site.
No placeholders, no internal contradictions, no scope drift beyond the ticket.

### Non-blocking notes

- `tasks.md`'s headings are double-numbered (`## 1. ### Backend — migration`) — a template/markdown
  rendering quirk, not an ambiguity that affects execution.
- Task 4.3's frontend normalization is defensive rather than strictly load-bearing given the
  server-side field is `NOT NULL`; fine to keep for consistency with the HEL-416 precedent the
  ticket calls out, but worth noting during evaluation that its absence would not itself violate an
  AC.
