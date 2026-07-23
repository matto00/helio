# HEL-416: Scheduled runs: schedule config UI in the pipeline editor (interval/cron, enable, next-run)

## Context

With the schedule model (HEL-414) and runtime (HEL-415, sibling) in place, users need to configure a schedule from the app. The pipeline editor is `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` (+ `PipelineDetailFooter.tsx`); pipeline API calls live in `frontend/src/features/pipelines/services/pipelineService.ts` and state in `state/pipelinesSlice.ts`.

## Scope

Frontend:

- A schedule config surface in the pipeline editor: choose interval or cron, enter the expression (with inline validation / a friendly interval picker), enable/disable toggle, timezone, and a read-only next-run display.
- Service calls to the schedule CRUD routes from HEL-414; wire into the pipelines slice.
- Show the current schedule state (enabled + next run) on the pipeline detail page.

## Acceptance criteria

- [ ] A user can set, edit, enable/disable, and clear a pipeline's schedule from the editor; changes persist via the schedule routes.
- [ ] Invalid expressions are surfaced inline (mirror the backend validation from HEL-414).
- [ ] The next-run time is displayed when a schedule is enabled.
- [ ] Follows `DESIGN.md`; frontend tests cover set/edit/disable + validation display.
- [ ] Backward compatible: additive UI; pipelines without a schedule render as today.

## Out of scope

- The scheduler runtime (sibling ticket) and run provenance labeling (sibling ticket).
- Generic design-system work (v1.7).

## Dependencies

- Blocked by HEL-414 (schedule model + CRUD routes) — MERGED to main (PR #269, d908eb35).
- Pairs with HEL-415, the scheduler runtime — MERGED to main (PR #270, 25783a32).

## Predecessor implementation notes (from batch context)

HEL-414 (PR #269, d908eb35):
- `pipeline_schedules` table (Flyway V62)
- `GET/PUT/DELETE /api/pipelines/:id/schedule` (PUT = upsert)
- Hand-rolled cron/interval/timezone validation with clear 400s
- `schemas/pipeline-schedule.schema.json` + `schemas/put-pipeline-schedule-request.schema.json`

HEL-415 (PR #270, 25783a32):
- In-process scheduler runtime (Pekko timer actor, restart-safe, no overlap)
- `CronSchedule` next-fire calculator
- Fix: PUT resets `next_run_at` on cadence changes so edits take effect on the next tick

## Ticket metadata

- Linear URL: https://linear.app/helioapp/issue/HEL-416/scheduled-runs-schedule-config-ui-in-the-pipeline-editor-intervalcron
- Parent epic: HEL-340 (Scheduled runs)
- Project: Helio v1.6 — Agentic Workflows & Pipelines
