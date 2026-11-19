## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 5f137cb5ffbf358b4ac47f044ad6fe26fce74d37 (planning artifacts uncommitted in the worktree).

### What I verified (with evidence)

**design.md Context claims, checked against the code:**
- `GET /api/dashboards` is owner-only. TRUE. `DashboardRoutes.scala:40` calls `DashboardService.findAllWithPipelineFedFlag`. That calls `findAll` (`DashboardService.scala:66-76`), which calls `dashboardRepo.findAll(user.id, page)` (`DashboardRepository.scala:57`).
- `findAllVisible` has no production caller. TRUE. The only references outside its definition are in `DashboardPanelAclSpec.scala:281-296`. Its docstring (`DashboardRepository.scala:163-168`) says "NOT wired to any UI route".
- `DashboardRoute.tsx` shows "Dashboard not found" for any id missing from `state.dashboards.items` once the list has loaded. TRUE (`DashboardRoute.tsx:28-50`).
- The panel-scoped routes in `PublicDashboardRoutes` are grant-aware. TRUE. `/panels` (l.222) and `/rows`, `filter-capabilities`, `distinct-values`, `output-meta`, `history`, `insight` and `provenance` (l.88-198) all go through `authorizeResourceWithSharing`.
- The grant body. `PermissionRoutes.scala` POST takes `GrantPermissionRequest(granteeId: Option[String], role: String)` (`PermissionProtocol.scala:8`). The route is owner-only (`PermissionService.grant` -> `requireOwnerOnly`). **`granteeId` omitted or null writes a PUBLIC grant**, which is a trap for the spec (see CR2).
- Supporting evidence: the HEL-1746 lane wrote the same claim into `e2e/hel1746-ask-ui.spec.ts:458-459` and routed around it with a pipeline grant. It is still unproven by any test.
- The helpers the plan relies on exist: `e2e/support/auth.ts` (`registerUser`, `currentUserId`, `registerAndLogin`) and `e2e/support/evidencePath.ts`. There is also a pipeline-free panel kind: `PanelKind` includes `text`/`markdown`/`divider` (`frontend/src/features/panels/types/panel.ts:65`).

**Is deferring stage 2 sound?** Yes. The ticket's first AC is explicitly verify-first. The open questions are real product decisions that the ticket and code do not settle: deep-link in the shell vs the `/dashboards/:id/panels` viewer, whether shared dashboards are listed, how panel data stays on panel-scoped routes (HEL-921), and whether editors are in scope. Planning the fix before the proof would be the premise-first failure this ticket exists to avoid. A red spec kept on an unpushed branch is acceptable.

**Would the stage-1 e2e genuinely prove or refute the claim?** Mostly yes, but the control design has two defects. Its own mutation plan would hit one of them (CR1). The other leaves "red for the right reason" unproven (CR2).

### Verdict: REFUTE

### Change Requests

1. **D3(a) predicts the wrong result.** It says: "grant the stranger a viewer role temporarily -> stranger test goes red". If the claim is true (which is the whole hypothesis), a stranger given a viewer grant still gets "Dashboard not found". The list stays owner-only, so the stranger control stays GREEN under this mutation. It cannot fail on `main` and is not a valid mutation of the stranger control. Replace it with a mutation that does flip the control on `main`, for example running the stranger test against a dashboard the stranger owns, or signed in as the owner. Then the control demonstrably distinguishes "not found" from "found". You can keep "grant the stranger viewer and observe" as an extra NON-asserting observation if you want: it shows the grant does not change the outcome. But it must not be labelled as a control mutation expected to go red.

2. **D2's "the controls being green proves seeding and grant succeeded" is false for the grant.** Neither the owner control nor the stranger control exercises the viewer grant. If the grant silently failed, or wrote a public grant because `granteeId` was missing or wrong (`GrantPermissionRequest.granteeId` is optional, and None means public), the viewer test would still be red with "Dashboard not found". It would then be red for the wrong reason. Make the grant's effect an ASSERTED precondition in the viewer test, before the UI assertion, not non-asserting evidence:
   - (a) `POST /api/dashboards/:id/permissions` returns 201 with `granteeId === viewerId` and `role === "viewer"`;
   - (b) the viewer's `GET /api/dashboards/:id/panels` returns 200 and contains the seeded panel (this proves the grant is live server-side);
   - (c) the stranger's `GET /api/dashboards/:id/panels` returns 404 (in the stranger control).

   Only with (a)+(b) passing does a red UI assertion isolate the shell-side cause. Keep "viewer's `GET /api/dashboards` does/doesn't include the id" as recorded evidence, since it is the diagnosis. Update D2's wording to match.

3. **The proposal and design disagree on the panel kind.** proposal.md says "a dashboard holding one Output panel". design.md D1 says "one panel that renders a visible, unique title without needing a pipeline". Pick one and make both artifacts say it. Recommendation: a `text`/`markdown` panel is enough for the stage-1 not-found question and avoids pipeline seeding. If an Output panel is wanted as stage-2 groundwork (showing that a dashboard-only viewer's panel data must stay on panel-scoped routes), say so and accept the extra seeding.

4. **The "if green, close the ticket" branch skips the ticket's RLS note.** The Risks section says a green viewer test means the claim is false and the ticket closes. The ticket's agent notes require checking RLS as `helio_app`, because dev and CI run as superuser. RLS can only narrow what a query returns, so a RED in dev implies red in prod for this owner-filtered list. A GREEN in dev does not imply green in prod. Add to Risks/tasks: if the viewer test is green, re-verify the viewer's list/panels reads under `helio_app` (non-BYPASSRLS) before recommending closure. If red, state explicitly that RLS cannot rescue an owner-filtered `WHERE`, so no RLS run is needed for stage 1.

### Non-blocking notes

- In D1.3 the order of assertions matters. `expect(...not found...).toHaveCount(0)` can pass vacuously while the list is still loading (`PageStatus` "Loading dashboard"). The red would then be a title-visibility timeout. To keep the failure message diagnostic, first wait for EITHER the panel title OR "Dashboard not found" to become visible (for example `expect(title.or(notFound)).toBeVisible()`), then assert `notFound` has count 0 and `title` is visible.
- Persist the stage-1 screenshot with `persist-evidence.sh` as well as `evidencePath`, because the escalation to the owner will cite it after the worktree is gone.
- Clean up registered users and the dashboard by exact id, in line with the existing `userCleanup` registry pattern.
