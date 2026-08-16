## Why

419-B (HEL-509) records assertion pass/fail per run but never changes run behavior — a failing `error`
rule is just data. This ticket adds the FAIL POLICY: an `error`-severity assertion failure blocks the
DataType update entirely (bad data never reaches bound panels/metrics), while `warn`-severity failures
are recorded and the run proceeds unchanged. This is what makes an "alive" agentic dashboard trustworthy.

## What Changes

- `PipelineRunService.onRunSuccess` computes `blockingFailures` from the run's already-evaluated
  assertion results (`assertionResults.filter(r => r.severity == "error" && !r.passed)`) before doing
  anything else.
- **Blocked path** (`blockingFailures.nonEmpty`): skip the DataType schema upsert, row overwrite, binary
  ref overwrite, and alert-rule evaluation entirely — the prior DataType snapshot is untouched. Mark the
  run's terminal status `"failed"` (reusing the existing status — see Non-goals) with a descriptive,
  structured `errorLog` naming which rule(s) failed. Assertion results are still persisted regardless
  (419-B's existing, unconditional behavior).
- **Warn-only / all-pass path** (unchanged): the existing success flow runs exactly as it does today.
- Dry runs are exempt — a dry run never writes DataType data in the first place (see design.md).
- No new Flyway migration: `"failed"` is already a valid `pipeline_runs.status` and
  `pipelines.last_run_status` value, and already a registered SSE terminal status
  (`RunStatusEvent.TerminalStatuses`).
- **Scope widened at the design gate's third round** (human-authorized): `RunResultResponse` gains
  `blocked`/`blockedReason` fields so `BoundPanelService` and `PipelineProposalService` — both of which
  call `pipelineRunService.submit(...)` for a brand-new pipeline's *first* run and treated any `Right`
  result as unconditional success — can now detect a blocked first run and trigger the same
  compensating cleanup/rollback they already run for a `Left`. Without this, a blocked first-run pipeline
  (no prior-good-data snapshot to fall back on) would still get a bound panel / a "success" proposal-apply
  response pointing at a DataType with zero rows. See design.md Decision 8.

## Capabilities

### New Capabilities

- `pipeline-assert-fail-policy`: the block/warn decision on a completed run's assertion results, and its
  effect on the DataType write path.

### Modified Capabilities

- `pipeline-run-execution`: the blocked-run outcome directly contradicts three existing, unconditional
  requirements — `pipelines.last_run_status` set to `"succeeded"` on any exception-free execution, the
  DataType schema always being written on a successful non-dry run, and a successful non-dry run always
  reaching `pipeline_runs.status = "succeeded"`. Each is carved out for the blocked case.
- `pipeline-run-sse`: the "Succeeded event carries row count" scenario is contradicted the same way — a
  blocked run completes without exception yet publishes `failed`, not `succeeded`.
- `alert-evaluation-engine`: "Evaluation never fails the triggering pipeline run" only covers a run that
  *fails* before the row-write step; a blocked run *succeeds* (reaches `onRunSuccess`) but is withheld
  before that same step for a different reason, which the existing requirement text doesn't literally
  cover.
- `datatype-row-snapshot`: "DataType row snapshot is persisted after a successful non-dry run" is the
  same unconditional "after a successful non-dry run" claim as `pipeline-run-execution`'s schema-write
  requirement, but in a separate capability governing `data_type_rows` directly — the exact table the
  ticket's AC1 names.
- `pipeline-list-api`: "Backend pipelines table exists" makes the identical `pipelines.last_run_status`
  claim already carved out in `pipeline-run-execution`, duplicated in this second capability's own
  requirement text.
- `bound-panel-composition`: "A mid-chain failure names its stage and triggers compensating cleanup"
  already treats a run failure as a `"run"`-stage failure triggering rollback — extended so a blocked
  run (which returns `Right`, not `Left`, from `submit()`) is treated identically (design.md Decision 8,
  found at the design gate's third round; scope widened with human authorization).
- `pipeline-proposal-apply`: "Full rollback on any mid-apply failure" already treats "the run itself"
  failing as a rollback trigger — extended the same way (design.md Decision 8). `combined-proposal-apply`
  needs no delta of its own: it composes `PipelineProposalService`'s Either result unchanged, so it
  inherits this fix transitively.
- `external-run-hooks`: "External trigger endpoint launches a pipeline run" makes the same
  unconditional-`Right`-means-`"succeeded"` claim `BoundPanelService`/`PipelineProposalService` had — a
  third caller of `pipelineRunService.submit(...)` found at the design gate's fifth round (a completion
  of round 3's audit, not a new category of scope question). Unlike the first two, this caller needs no
  rollback (a hook-triggered run is always a re-run of an existing pipeline, so the prior snapshot is
  already correct) — only the reported `status` field changes.

## Impact

- Backend only: `services/PipelineRunService.scala` (`onRunSuccess`'s body split into a blocked branch
  and the existing succeeded branch, return type `Future[Unit]` → `Future[Boolean]`; a new private
  summarization helper), `services/BoundPanelService.scala` and `services/PipelineProposalService.scala`
  (one new `blocked`-checking guard each, reusing existing cleanup/rollback paths),
  `api/protocols/PipelineProtocol.scala` (`RunResultResponse` gains two default-valued fields,
  `jsonFormat5` → `jsonFormat7`).
- No new API route, no frontend changes — `RunResultResponse`'s wire shape gains two backward-compatible
  optional fields (existing decoders unaffected); run-history/panel-badge UI surfacing is still 419-D.

## Non-goals

- Raising an external alert specifically ON an assertion failure (HEL-430's alert-rule system; a natural
  future trigger, explicitly out of scope here).
- Run-history / panel badge UI (419-D).
- A new `pipeline_runs.status` value — the existing `"failed"` status is reused (see design.md); a
  migration is added only if a design review overturns that decision.
