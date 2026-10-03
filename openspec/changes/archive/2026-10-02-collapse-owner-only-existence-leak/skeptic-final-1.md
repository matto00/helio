## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Head reviewed: 67fbaaf6a87ed0f8677f1c2f2b8c803f74738717

### What I verified (with evidence)
- Diff vs live base 7b146b34: AccessCheckerImpl.requireOwnerOnly (no grant -> NotFound(notFoundMessage), grantee -> 403), requireAccess no-grant -> NotFound, AclDirective both arms -> NotFound(notFoundMessage), ShareTokenService.mapForbiddenToNotFound deleted (HEL-590 AC met), PanelService update/delete/duplicate/batchUpdate and PatchSetApplyResolvers panel/step sites moved to visibility-filtered lookups.
- Own full run `cd backend && nice -n 19 sbt testFull`: Suites 368, Tests succeeded 5311, failed 0 (PublicRouteOwnerIdLeakSpec ran, not regressed). sbt shut down separately.
- Mutation check (reverted after, tree clean): changing requireAccess no-grant arm back to Forbidden made 11 tests in ExistenceNotLeakedRoutesSpec fail (incl. permissions/share-token/pipeline-permission rows and the Forbidden-producer pin). The parametrised spec can fail; compares status + content-type + full body with id normalised, and has owner-control rows plus a viewer-grantee 403 retention test.
- Oracle hunt: re-read every remaining ServiceError.Forbidden producer in backend/src/main (PipelineRunService 232/583, PipelineService 2343, PanelService 134/235/450/561/724, OutputService 146, DashboardService, resolvers). All sit behind a visibility-filtered lookup (findByIdShared/findById(Some(user))/requireAccess), so the caller already knows the resource exists; tier, PAT-scope, CSRF, CORS 403s untouched. Pipeline step routes, schedule routes (findByIdOwned, single message), run-events (single message), output provenance (owner-scoped) show no status/message divergence. Remaining findByIdInternal uses are post-ACL or internal.
- Frontend: only 403 key is classifyRequestError (forbidden/not-found render equivalently); no frontend diff; backend-only so no new visual surface. I did not re-run the both-theme visual check; relied on evaluator's claim (unchanged frontend).
- Not-an-oracle-of-this-ticket observation: GET /api/pipelines/:id/runs/:runId (PipelineRunStatusRoutes) ignores the pipelineId and does no ownership check; pre-existing, unrelated to 403/404, worth a spinoff.

### Verdict: REFUTE

### Change Requests
1. helio-mcp/src/tools/write.ts:963 (model-facing tool description of `delete_dashboard`) still says "Owner-only — a non-owner gets 403, an unknown id 404." This is now false (both are 404) and is text shipped to agents; the comment at write.ts:953 ("the backend's 403 (not owner) / 404 (unknown id)") is stale likewise. The ticket AC requires helio-mcp error text keyed on 403 be checked and updated; only the helioApi.ts comment was fixed. Update both to say a non-owner and an unknown id both get 404 (a grantee without owner rights still gets 403), and check for any helio-mcp test pinning the description string. Also review other delete_* / owner-only tool descriptions for the same claim (grep showed only this one).

### Non-blocking notes
- Timing difference (extra findGrant on foreign arm) is disclosed as a non-goal; fine.
- PipelineRunStatusRoutes run-id lookup has no pipeline/owner scoping (pre-existing).
