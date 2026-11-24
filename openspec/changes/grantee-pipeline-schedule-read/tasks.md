## Tasks

### Backend
- [x] 1.1 Add `PipelineScheduleRepository.findByPipelineIdInternal(pipelineId)` (withSystemContext), documented as authorized-caller-only
- [x] 1.2 `PipelineScheduleService.find`: authorize via `pipelineRepo.findByIdShared(pipelineId, Some(user))`, read via the internal variant
- [x] 1.3 Leave `put`/`delete` on `findByIdOwned`; update the class doc comment to state read-all / owner-writes
- [x] 1.4 Confirm `PipelineScheduleResponse` carries no owner/grantee id; adjust `schemas/pipelines/pipeline-schedule.schema.json` description only if needed

### Frontend
- [x] 2.1 `SpineScheduleChip`: read-only, non-interactive variant (renders nothing for a null schedule)
- [x] 2.2 `PipelineSpineHeader`: schedule chip/menu items owner-only; grantees get the read-only chip
- [x] 2.3 `MobilePipelineHeader`: same gating as 2.2
- [x] 2.4 `PipelineDetailDialogs`: schedule dialog opens only for the owner
- [x] 2.5 `usePipelineSourceScheduleActions`: toggle guard on ownership; caller passes `isOwner`

### Docs
- [x] 3.0 At archive: make the base `pipeline-schedule-config-ui` "Schedule bar" requirement owner-qualified (MODIFIED delta) so the archived spec does not say the chip is never hidden for grantees
- [x] 3.1 CLAUDE.md schedule route line states the access rule (owner + editor/viewer read; owner-only writes, grantee 404)

### Tests
- [x] 4.0 Flip existing viewer assertions deliberately (PipelineSpineLayout.viewerReadOnly, PipelineMobileLayout.viewerReadOnly, e2e hel1794): a viewer with a schedule now sees the read-only chip; never weaken them
- [x] 4.1 RED first, committed as .txt: route spec per role (owner GET/PUT/DELETE; editor GET 200, PUT/DELETE 404 and unchanged; viewer same; stranger and unknown id 404)
- [x] 4.2 Service spec for `find` with a grantee on a real DB (the barrier it pins is `findByPipelineId`'s explicit ownerId JOIN; RLS is bypassed in dev/CI, so name the JOIN, not RLS)
- [x] 4.3 Jest: chip read-only variant; spine + mobile headers per role (owner unchanged, editor/viewer chip + no write control, unknown role fails closed); dialog gating
- [x] 4.4 e2e: editor and viewer grantee see the read-only chip and no "Add schedule"/schedule menu item; owner unchanged
- [x] 4.5 Mutation checks: revert 1.2 to `findByIdOwned` and to a non-internal read; revert 2.2 gating to `canEdit` -- each must turn a test red
