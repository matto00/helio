## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 5f137cb5ffbf358b4ac47f044ad6fe26fce74d37 (planning artifacts uncommitted in the worktree). I formed my own view from the code first, then compared it with round 1.

### What I verified (with evidence)

**Factual claims, checked against the code:**
- `GET /api/dashboards` is owner-only. `DashboardRoutes.scala:40` calls `findAllWithPipelineFedFlag` (`DashboardService.scala:71`), which goes through `DashboardService.findAll` (l.66) to `DashboardRepository.findAll(ownerId, page)` (l.57). `findAllVisible` (`DashboardRepository.scala:169`) has no caller in `backend/src/main`.
- `DashboardRoute.tsx`: once `status` is no longer idle or loading, an id missing from `state.dashboards.items` renders `EmptyState title="Dashboard not found"`. `/dashboards/:id` is inside `ProtectedRoute`/`AppShell` (`AppRoutes.tsx:122`), and no redirect for users with zero dashboards sits in front of it. So a freshly registered viewer or stranger will reach this branch.
- Grant route: `PermissionRoutes.scala` POST takes `GrantPermissionRequest(granteeId: Option[String], role)`, uses `requireOwnerOnly`, and returns `StatusCodes.Created -> PermissionResponse(granteeId: Option[String], role, createdAt)`. `PermissionService.grant` maps `granteeId = request.granteeId.map(UserId(_))`, so None means a PUBLIC grant. This confirms D1.2's trap, precondition D1.3(a) (201 with `granteeId`/`role` fields that exist in the response), and D3(c): dropping `granteeId` returns 201 with `granteeId: null`, so precondition (a) fails, as the design predicts.
- `GET /api/dashboards/:id/panels` (`PublicDashboardRoutes.scala` ~l.222) goes through `authorizeResourceWithSharing`. In `AclDirective.scala:110-120` a signed-in non-owner holding a grant row resolves to Viewer or Editor without a token. So precondition (b) (200 for the viewer) and the stranger's 404 are the outcomes the code predicts. Both are valid assertions.
- The helpers exist: `e2e/support/auth.ts` (`registerUser`, `currentUserId`, used the same way in `e2e/hel1746-ask-ui.spec.ts:11,461`), `e2e/support/evidencePath.ts`, and `e2e/support/userCleanup.ts`.

**Round-1 change requests: all four are resolved in the artifacts.**
1. D3(a) no longer uses "grant the stranger viewer" as a mutation. It runs the stranger's UI steps as the owner, or against a dashboard the stranger owns, and keeps the grant-the-stranger case only as a non-asserting observation.
2. The grant is now an ASSERTED precondition: D1.3(a) and (b) come before the UI assertion, and the stranger's 404 is asserted. D2 is reworded to match.
3. The panel kind is consistent. Both proposal.md and design.md say `text`/`markdown`, with no pipeline.
4. The RLS branch is handled correctly (see below).

**Would the e2e prove or refute the claim?** Yes. Preconditions (a) and (b) isolate the cause on the shell side: the grant is real, targeted and live on the server before the UI is judged. The either-or wait (`title.or(notFound)`) removes the vacuous loading-state pass or fail. The owner and stranger controls show that the page can render both outcomes and tell them apart. If the claim is true, the viewer test is red at `notFound` count 0. If false, it is green.

**RLS handling is correct.** RLS can only remove rows. A red result in dev comes from the explicit `owner_id` filter, so prod as `helio_app` cannot be more permissive. A green result in dev does not carry over to prod, and task 1.4a re-verifies under `helio_app` before anyone recommends closing.

**Deferring stage 2 is sound.** The ticket's AC1 is verify-first. AC2 and AC3 only apply if the claim is true. The open questions are real product decisions that neither the ticket nor the code settles: where a grantee lands, how the list should show shared dashboards, how panel data reads stay on panel-scoped routes under HEL-921, and whether editors are in scope. Escalating them with the evidence beats guessing.

**Scope:** stage 1 changes only the test file. No product code and no contract change, so no delta is needed. Nothing is TBD that blocks writing the spec.

### Verdict: CONFIRM

### Non-blocking notes
- D3(a) has a side effect. In the stranger test the API precondition (panels 404) runs before the UI steps. If the mutation signs in as the owner, or uses a dashboard the stranger owns, that precondition goes red first, at the wrong assertion. When running the mutation, apply it only to the UI half (navigate as the owner while keeping the stranger's API assertion), or note in the transcript which assertion failed. Task 1.4 already says "confirm each goes red at the intended assertion", so hold the executor to it.
- Check that a `text`/`markdown` panel's title (or a unique body string) actually shows in the signed-in `PanelList`. If the title is not rendered for that kind, pick a locator that is visible for the owner control. Otherwise the owner control could fail for a cosmetic reason.
- Confirm that `start-servers.sh` actually honours the lane `DATABASE_URL` (D4). If it does not, the run uses the shared dev DB, which is a residue risk but not a correctness risk.
