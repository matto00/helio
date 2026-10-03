## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Head reviewed: 2106717e078e90da65351fae630e77955f7952b7

### What I verified (with evidence)
- Delta since round-1 head 67fbaaf6: `git diff 67fbaaf6 HEAD` touches only helio-mcp/src/tools/write.ts (comment at :953 and delete_dashboard description at :963, now "a non-owner and an unknown id both get 404 (a grantee without owner rights gets 403)") plus openspec artifacts. No backend/frontend change, so the round-1 backend review stands. Round-1 REFUTE item (stale model-facing text) is fixed.
- Grep of helio-mcp/src for 403/non-owner/Forbidden: remaining hits are legitimate (free-tier TIER_FORBIDDEN refinement.ts:60, connector 401/403 fetchError hints, the updated helioApi.ts:1270 comment). No stale claim remains.
- Own full run `cd backend && nice -n 19 sbt testFull`: Suites 368, Tests succeeded 5311, failed 0, "All tests passed" (includes ExistenceNotLeakedRoutesSpec and PublicRouteOwnerIdLeakSpec). sbt shut down separately.
- Oracle re-hunt: re-read every remaining ServiceError.Forbidden producer in backend/src/main (PanelService 134/235/450/561/724, PipelineRunService 232/583, PatchSetApplyResolvers 107/125/356/388, DashboardService 158/178/219/316, OutputService 146, PipelineService 2343, AutoLayout 143, DashboardContents 149). Each sits behind a visibility-filtered lookup (findById(Some(user)) / findByIdShared / requireAccess), so a stranger gets None/NotFound first; Forbidden only reaches a grantee or owner-already-known resource. AccessCheckerImpl: no grant -> NotFound(notFoundMessage), grantee -> 403. Tier, PAT-scope, CSRF, CORS 403s untouched. ShareTokenService local mapping removed.
- AC trace: identical status+body (AccessCheckerImpl/AclDirective + parametrised ExistenceNotLeakedRoutesSpec, mutation-checked red in round 1: 11 failures); HEL-590 mapping removed; frontend keys only on classifyRequestError (forbidden/not-found equivalent, no diff); helio-mcp updated; PublicRouteOwnerIdLeakSpec green.
- UI: no frontend diff; I did not re-run the visual check (nothing to judge).

### Verdict: CONFIRM

### Non-blocking notes
- Timing side channel (extra findGrant on foreign arm) disclosed non-goal.
- Pre-existing, unrelated: GET /api/pipelines/:id/runs/:runId ignores pipelineId/ownership; worth a spinoff.
- evaluation-3.md is untracked in the worktree; ensure it is committed.
