## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d4e59f00629852df6debf9cc988c0c8a183483a4 (change artifacts uncommitted in the worktree).
The owner ruling "Read all, owner writes" is taken as settled. I checked each design claim against the live tree.

### What I verified (with evidence)
- **Barrier claim (D1 context).** `PipelineScheduleService.find/put/delete` all gate on `pipelineRepo.findByIdOwned`
  (PipelineScheduleService.scala). `PipelineScheduleRepository.findByPipelineId` runs under `withUserContext`. It
  also has an explicit `pipeline.ownerId === ownerUuid` JOIN, so swapping only the ACL check would still return "no
  schedule" to a grantee. The plan's conclusion holds: a second read path is needed.
- **`findByIdShared` is the right check.** PipelineRepository.scala:83-108 admits the owner, or a caller with a
  `resourceType = "pipeline"` grant row, and returns `None` otherwise (no anonymous path). The read routes use it
  together with an internal variant: `PipelineService.listSteps` (~line 210) and its "Safe: access confirmed by
  findByIdShared above. Use internal variant" comment.
- **The privileged-read precedent exists.** `listTickCandidatesInternal`/`updateAfterTickInternal` in the same repo
  use `ctx.withSystemContext` (the BYPASSRLS privileged pool, DbContext.scala:53-64). DbContext requires an inline
  bypass comment at every callsite, and D1 already plans one.
- **D2 (grantee writes get 404).** `PipelineService.updateName`/`delete` (lines ~113-140) use `findByIdOwned` and
  return `NotFound`, which `ServiceResponse.run` maps to 404. Their doc comments say "403", but the code gives 404,
  so the design's 404 claim matches the code. In `put`, the ACL check runs before `validate`, so a grantee with a
  valid body gets 404 before any write.
- **D3 (response shape).** `PipelineScheduleResponse` and `schemas/pipelines/pipeline-schedule.schema.json` carry
  no owner or grantee id. The schema description says nothing about access.
- **D4 client gating sites.** I grepped `savePipelineSchedule|deletePipelineSchedule|setScheduleOpen|scheduleOpen`
  across non-test `frontend/src`. The write entry points are:
  - `PipelineSpineHeader` (chip at line 219; menu items at 80-93, gated on `canEdit`; it already receives the
    required `isOwner` prop at line 48)
  - `MobilePipelineHeader` (menu item at line 69; chip at 194-195)
  - `PipelineDetailDialogs:137` (`open={page.scheduleOpen && page.canEdit}`)
  - `usePipelineSourceScheduleActions:45` (guards on `canEdit`; called from `usePipelineDetailPage:133`, where
    `isOwner` is already in scope at line 60)
  - `PipelineSpineLayout` only forwards `onEditSchedule`/`handleToggleScheduleEnabled` to the header, so gating
    the header and the hook covers it.

  There is no other entry point: the keys test only lists `scheduleOpen` as a returned key, and the toast
  listeners only react to thunks. `isPipelineOwner` fails closed, and `failClosedRoleGuard.test.ts` enforces
  `isOwner = false` defaults.
- **The fetch is unconditional.** `usePipelinePageLoad.ts:75` dispatches `fetchPipelineSchedule(id)`. The thunk
  turns a 404 into `schedule: null` (pipelineScheduleThunks.ts:21-35), so a grantee's 200 fills the chip with no
  client change.
- **D5 MCP.** In `helio-mcp/src/tools/scheduleTools.ts:43-68`, none of the get/set/delete descriptions mentions
  ownership or grantees, so no source change is needed. CLAUDE.md:180 is the route line the plan updates.
- **Spec deltas.** The MODIFIED requirement names ("Get pipeline schedule", "Delete pipeline schedule") match
  `openspec/specs/pipeline-schedule-crud-api/spec.md` exactly, and every original scenario is kept in the
  replacement text. The new grantee scenarios cover the derived acceptance detail: owner, editor, viewer,
  stranger and unknown id; GET, PUT and DELETE.
- **AC coverage.**
  - AC1 (server and client agree): D1/D2 and D4, plus both spec deltas.
  - AC2 (no refused control): D4 and the config-ui ADDED requirement.
  - AC3 (per-role tests on the route and in the UI): tasks 4.1-4.5. Red goes first and mutations are listed.
  - Derived details: MCP and schema (1.4, D5), CLAUDE.md (3.1), the e2e (4.4, with a home in
    `e2e/hel1794-viewer-read-only.spec.ts`).
  - Scope drift: none. The non-goals (HEL-1574 list endpoint, migration, MCP code) are justified.
- **Placeholders and contradictions.** No TBD or TODO. The chip variant shape ("e.g. `readOnly` prop or a sibling
  component") is left to the implementer, but its acceptance properties are fixed: non-button, the same text and
  classes, a state-reading accessible name, null renders nothing. That is a harmless choice, not an ambiguity.

### Verdict: CONFIRM

### Non-blocking notes
1. **The base config-ui spec will still contradict the new rule.** Its "Schedule bar shows current schedule state"
   requirement says the desktop chip "is never hidden" and offers "Add schedule". "Backward compatible" offers
   "Set schedule". The new ADDED requirement makes both false for grantees. HEL-1794 left the same gap for
   viewers. Changing the ADDED requirement into a MODIFIED one on "Schedule bar shows current schedule state",
   qualified "for the pipeline owner", would keep the archived spec self-consistent. Doing this at the archive
   step is fine.
2. **Task 4.2 names the wrong barrier.** It says the test "exercises the RLS barrier on a real DB". RLS is
   bypassed in dev/CI (superuser; see MEMORY "RLS testing parity gap"). What actually blocks a grantee on the
   current read path is the explicit `ownerId` JOIN in `findByPipelineId`. The planned mutation (revert to the
   non-internal read) still goes red because of that JOIN, so the test is valid. The PR and test comments should
   name the JOIN, not RLS.
3. **Read-only chip accessibility.** A `<span aria-label>` with no role is not reliably announced (`aria-label` on
   a generic element is prohibited). Use the visible text as the name, or give it an appropriate role. Do not
   make it focusable.
4. **Existing viewer tests will need flipping.** `PipelineSpineLayout.viewerReadOnly`,
   `PipelineMobileLayout.viewerReadOnly` and the `hel1794` e2e currently expect no chip for a viewer. With a
   schedule present, a viewer now sees the read-only chip. Update those assertions deliberately; do not weaken
   them.
5. The `updateName`/`delete` doc comments in PipelineService.scala say grantees get "403", but they actually get
   404. The executor may correct this if they touch it. It is not required.
