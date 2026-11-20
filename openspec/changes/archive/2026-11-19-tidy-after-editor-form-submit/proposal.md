## Why

HEL-1784's review left three non-blocking leftovers: a dead parameter on `PipelineRunService.recordUnrunnable`, a
missing existence-leak probe for the new `GET /api/panels/:id/form-schema` route, and archived design/tasks wording
that names a proof the delivered spec does not use. Each is small, but the first two are exactly the shape that rots
(a parameter that looks meaningful but is never set; a guarded route outside the leak sweep).

## What Changes

- Remove `triggeredByUserId: Option[UserId] = None` from `PipelineRunService.recordUnrunnable`. Its only callers
  (`PipelineProposalService` proposal-apply, `PipelineSchedulerService` scheduled skip) act as the user who triggered
  the attempt, so the stored `triggered_by_user_id` stays `user.id`, exactly as today. No caller loses attribution.
- Add a `GET /api/panels/{id}/form-schema` row to `ExistenceNotLeakedRoutesSpec` (target `Panel`, site
  `PanelService.scala`), shown red by a mutation that makes a foreign panel distinguishable from an absent one.
- Reword `design.md` (D7 RLS bullet) and `tasks.md` 4.1 of the archived HEL-1784 change to name the real proof: the
  owner's `pipeline_run_rate_window` row (and none for the editor) in `FormSubmitEditorRlsSpec`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. No observable behavior changes (`skip_specs: true`).

## Non-goals

- No change to any route's behavior, status codes or bodies; no migration (Flyway max stays V146); no frontend change.
- No new attribution path for unrunnable runs (no caller has a distinct triggerer today).
- No edits to the archived HEL-1784 change beyond the two named lines.

## Impact

- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` (signature only).
- `backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala` (one row).
- `openspec/changes/archive/2026-11-19-editors-submit-form-panels/{design,tasks}.md` (wording).
