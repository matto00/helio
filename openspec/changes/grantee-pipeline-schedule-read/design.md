## Context

`PipelineScheduleService.find/put/delete` (backend/src/main/scala/com/helio/services/pipelines/PipelineScheduleService.scala)
all start with `pipelineRepo.findByIdOwned`, so every grantee gets `404`. A second barrier sits under it:
`PipelineScheduleRepository.findByPipelineId` runs under `ctx.withUserContext`, and V62's only RLS policy on
`pipeline_schedules` (`pipeline_schedules_owner`) admits a row only when its pipeline's `owner_id` is the current user.
So swapping the ACL check alone would still return "no schedule" to a grantee.

The pipeline read routes already solve this shape: `PipelineService` read paths authorize with
`pipelineRepo.findByIdShared(id, Some(user))` (owner, or any `pipeline` grant row for the caller; `None` otherwise)
and then read the authorized row with an internal/privileged variant ("Safe: access confirmed by findByIdShared
above. Use internal variant", PipelineService.scala ~line 215). Owner-only pipeline writes (`delete`, `updateName`)
use `findByIdOwned` and answer every non-owner, grantees included, `404` (PipelineService.scala lines 114-134).

On the client, HEL-1794 gated schedule controls on `page.canEdit` (`canEditFromUi(runRole)`), which is true for
editors. `page.isOwner` (`isPipelineOwner(currentPipeline, currentUser)`) already exists and is false until both are
known, so it fails closed.

## Goals / Non-Goals

Goals: implement the owner ruling (read all, owner writes) consistently on server and client, red-first per role.
Non-goals: editor writes; `GET /api/pipeline-schedules` (HEL-1574 list, stays owner-scoped through RLS); any
migration; any response-shape change; any helio-mcp code change.

## Decisions

**D1. GET authorizes with `findByIdShared`, then reads the schedule privileged.** `find` calls
`pipelineRepo.findByIdShared(pipelineId, Some(user))`; `None` -> `NotFound("Pipeline not found")` (stranger and unknown
id indistinguishable, as today). On `Some`, read the schedule with a new
`PipelineScheduleRepository.findByPipelineIdInternal(pipelineId)` (`ctx.withSystemContext`, same shape as the file's
existing `listTickCandidatesInternal`), documented like `PipelineRepository.findByIdInternal`: reserved for a caller
that has just authorized this pipeline id; never called from a request path without that check. One read path for
owner and grantee keeps the response identical across roles. Rejected: widening the V62 RLS policy to grantees. It
needs a migration, and V62 has a single `USING` policy covering every command, so widening it would also open
UPDATE/DELETE at the RLS layer and leave owner-only writes resting on the service check alone. Rejected: a new
access helper; `findByIdShared` is the existing pipeline read check.

**D2. PUT/DELETE stay on `findByIdOwned`; a grantee gets `404`.** This matches how the neighbouring owner-only
pipeline writes (`PipelineService.delete`, `updateName`) answer an editor or viewer today. It is a deliberate
consistency choice even though a grantee can now read the schedule: the pipeline rename/delete routes already have the
same "readable but write is 404" shape. `403` would be more precise but would differ from those routes; the PR states
this. No code change to `put`/`delete` beyond tests pinning the grantee answer.

**D3. Response unchanged.** `PipelineScheduleResponse` carries `id, pipelineId, kind, expression, enabled, timezone,
nextRunAt, lastRunAt, createdAt, updatedAt` and no owner/grantee id. Executor verifies this against
`PipelineScheduleProtocol.scala` and `schemas/pipelines/pipeline-schedule.schema.json`; the schema needs at most a
description sentence (it currently says nothing about access).

**D4. Client: schedule writes gate on `page.isOwner`, not `page.canEdit`.**
- `SpineScheduleChip` gains a read-only mode (e.g. `readOnly` prop or a sibling component): rendered as a non-button
  element (no `onClick`, not focusable as a control) with the same icon, expression, next-run/"Paused" text and title,
  and an accessible name that reads as state, not as an action (not "Edit schedule"/"Add schedule"); use the visible text as its name or an appropriate role (no `aria-label` on a bare generic element), and keep it out of the tab order. It renders
  nothing when `schedule === null`. It reuses the chip's existing CSS classes so narrow-width forms (HEL-1579) apply.
- `PipelineSpineHeader` and `MobilePipelineHeader`: owner -> interactive chip and schedule menu items as today;
  anyone else -> read-only chip only. The other `canEdit` items (Rename, Edit/Add source, shapes) stay on `canEdit`
  unchanged (editors keep them).
- `PipelineDetailDialogs`: schedule dialog `open={page.scheduleOpen && page.isOwner}`.
- `usePipelineSourceScheduleActions`: the toggle guard uses ownership (pass `isOwner`), so no stray path PUTs for a
  grantee.
- The schedule fetch (`usePipelinePageLoad`) is already unconditional; grantees now receive 200 instead of 404.
Executor greps `savePipelineSchedule|deletePipelineSchedule|setScheduleOpen` across `frontend/src` to confirm no other
write entry point exists (current hits: the files above plus thunks/slice/service/toast listeners).

**D5. MCP and docs.** helio-mcp's `get_pipeline_schedule` now works for grantees with no code change; its
`set`/`delete` tool descriptions do not claim grantee access. No helio-mcp source change is planned, so no MCP
redeploy note is needed unless the executor finds a description that contradicts the ruling (then: source-only edit,
PR notes the redeploy). CLAUDE.md line `GET/PUT/DELETE /api/pipelines/:id/schedule` gains the access rule.

## Risks / Trade-offs

- A privileged read on a request path: mitigated by the authorization immediately before it, keyed by the same id,
  and a route test proving a stranger still gets `404` (and an unknown id too).
- Grantee write answered `404` while read succeeds: consistent with pipeline rename/delete; called out in the PR.

## Planner Notes

- Self-approved: D1 privileged read over an RLS migration (driver context says no migration expected; RLS widening
  would weaken write protection). D2 `404` per neighbouring routes, as the driver asked to match them.
- e2e home: no existing spec seeds an editor + viewer grantee on a scheduled pipeline; a new
  `e2e/hel1837-grantee-schedule-chip.spec.ts` modelled on `e2e/hel1794-viewer-read-only.spec.ts` grantee setup is
  the natural home (executor may instead extend hel1794 if its fixtures fit without churn).
- Avoid files of in-flight HEL-1840 (multi-denial toast, frontend toasts) and HEL-1841 (RestApiConnectorDriver,
  PipelineRootDryRun, PipelineProposalService).
