## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c7d5582af5e314f8277125745de7fabac91b195d` against base `27b4a7402e0135322c2fcac1aeba16540ddce0a4`,
which I resolved live with `resolve-review-base.sh` (exit 0). There are 2 commits. The worktree is clean apart from the
untracked `evaluation-1.md`, so no mutation residue is left behind. I did not read any `.env` file, did not dump the
environment, and started no servers (C1, C14, C16).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/assistant-search-mcp-shared-dashboards/HEL-1785`.

**Fresh gate runs (mine, not the evaluator's):**
- `nice -n 19 sbt -J-Xmx3g "testOnly WorkspaceSharedDashboardsSpec SharedDashboardOutputRoutesRlsSpec SharedDashboardPanelsSeamSpec PatchSetDashboardGrantSpec EditorGrantCoverageSpec"`:
  `Suites: completed 5, aborted 0 / Tests: succeeded 40, failed 0`, exit 0.
  - The tests really ran: the run printed new `[HEL-1785 RLS]`, `[HEL-1785 RLS6]` and `[HEL-1785 SEAM]` lines with
    fresh UUIDs and timestamps.
  - `testOnly` is not the bare `sbt test` that C5 forbids. For the whole suite I rely on the evaluator's pasted
    `testFull` result (10008 passed, 0 failed).
- `npx jest --maxWorkers=3 helio-mcp/src`: `Test Suites: 62 passed / Tests: 571 passed`.
- `npm --prefix helio-mcp run typecheck`: clean.

**AC1: search and context include shared dashboards with the role.**
- `WorkspaceContextService.assemble` (line 127) and `WorkspaceSearchService.find` (line 88) now read
  `DashboardService.findAllVisible`, which is HEL-1773's `findAllVisiblePaged`.
- `getResource(Dashboard)` reads the new `DashboardRepository.findVisibleWithRole`, which:
  - uses the same owned-or-named-grant join, filtered by id;
  - filters grants with `p.granteeId === uid` and roles `editor`/`viewer`;
  - runs in `withUserContext`;
  - returns one row at most, because of `unique_grantee_per_resource` (V16), so `headOption` is deterministic.
- Fresh run on `helio_app_test`:
  - Viewer/editor B: `Vector((A to B editor,Some(editor),0), (A to B viewer,Some(viewer),2), (B owned,Some(owner),0)) counts.dashboards=3`.
  - Stranger: `Vector()`.
  - `find` descriptions carry the role suffix.
  - Stranger and public-only both get `NotFound(Dashboard not found)`.
- On the wire, `WorkspaceContextDashboard.accessRole` uses `jsonFormat4`. The schema's `DashboardEntry` lists
  `accessRole` as required with the enum `owner|editor|viewer`, and a seam test validates a real response against it.

**AC2 and the server-refusal point: the assistant cannot capture an edit to a viewer's dashboard or a delete of a
dashboard it does not own.**
- `AssistantToolExecutor.executeProposePatchSet` (lines 327-335) sets `capturedProposal` only on
  `Right(preview)`.
- `preview` goes through `PatchSetApplyResolvers.resolveAll`. Every patch-set kind that touches a dashboard
  (`panel` update/delete/create, `dashboard` update/delete; `dashboard` create makes a new dashboard) refuses on the server:
  - `PatchSetApplyResolvers.scala:128`: viewer dashboard update.
  - `:206`: `authorizeEditorOnDashboard`, which serves panel update, delete and create through
    `PatchSetPanelResolvers.scala:38,71,135`.
  - `:157-158`: dashboard delete for any non-owner. `findById(…, Some(user))` returns `None` for a stranger, which gives
    NotFound.
- The fresh run printed:
  - `viewer rename panel -> Left(edit 0: You have view-only access to this dashboard) proposal=None`
  - `editor delete dashboard -> Left(edit 0: Only the dashboard's owner can delete it) proposal=None`
  - `editor rename -> Right(...) proposal=true`
- I grepped all of `backend/src/main/scala` for refusals that still carry no message:
  - The only remaining `Viewer => Forbidden()` is `OutputService.scala:148`, which is pipeline-scoped.
  - The bare `Forbidden()` at `DashboardService.scala:186` (duplicate) and `:255` (layout repair) are owner-only and
    outside the MCP write path.
  - `PatchSetApplyResolvers.scala:224` is the pipeline-editor check.
- Every dashboard and panel viewer refusal on the MCP write path now uses `DashboardAccessMessages`: `DashboardService`
  update, export and delete, `DashboardContentsService`, `AutoLayoutService`, and the four in `PanelService` (create,
  batch update, `authorizeEditor`, `authorizeEditorOnDashboard`). Panel duplicate and delete go through
  `authorizeEditorOnDashboard`. Status codes are unchanged.

**AC3: helio-mcp.**
- `listDashboards` sends `include=shared`. `context.ts` passes `accessRole` through.
- `getDashboard` has a viewer branch that reads paged `/panels` (limit 500, follows `total`, stops on an empty page)
  and maps the result to the export's panel shape.
- Write tools do no client-side check. `sharedDashboards.test.ts` asserts that `update_dashboard` and `delete_panel`
  produce `isError`, `status 403` and the view-only text, and that exactly PATCH and DELETE reached the server.
- `contextControls.ts:47-55` catches a failed export, so a viewer's export 403 degrades.
- `SharedDashboardPanelsSeamSpec` pins the shared `/panels` fixture to the real route's shape for a viewer.

**AC4 and the Output-data point: no Output rows, columns or pipeline ids for a dashboard-only grantee.**
- Assistant:
  - `getResource(DataType)` stays `outputRepo.findByIdOwned` (`WorkspaceSearchService.scala:213`).
  - `dashboardPanels` keeps `OutputReadAccess.readablePipelineId`, which uses an explicit pipeline-grant SQL
    predicate, not RLS alone. The fresh run shows `panels=Vector((…,None))` and
    `getResource(DataType) viewer=false editor=false pipeline-owner=true`.
  - The executor's tool set is only `find`, `get_resource`, `test_connection` and `propose_*`.
- Routes, on the NOBYPASSRLS `helio_app_test` pool (fresh run):
  - Viewer and editor both get 404 on `/api/outputs/A`, `/rows`, `/history`, `/history/P/rows`,
    `/distinct-values` and `/insight`.
  - The pipeline owner gets 200 on all of them, with non-empty rows, payload, distinct values and render. This is the
    positive control.
- I checked the reduction for the routes not called individually myself:
  - `/filter-capabilities`: `OutputRoutes.scala:202-204` → `OutputService.filterCapabilities:363` →
    `OutputRowReads.filterCapabilities:79-80`, which calls `outputRepo.findById(id, user)`.
  - `/assertion-status`: `OutputRoutes.scala:195-197` → `OutputService.assertionStatus:333-334`, which calls
    `outputRepo.findById`.
  - `/panels`: `OutputService.listPanels:309-310`, which calls `outputRepo.findById`.
  - `/provenance`: `ProvenanceRoutes` → `ProvenanceService.forUser:50-51`, which calls `outputRepo.findById`.
  - `/insight/history`: `OutputInsightReadService.history:43-44` → `InsightAccess.resolve:15-16`, which calls
    `outputRepo.findById` and then the pipeline `requireAccess`.
  - `OutputRepository.findById` (lines 144-145) is
    `ctx.withUserContext(...)(table.filter(_.id === id.value)...)`, the same statement the proven routes use. The
    reduction holds; none of these routes uses a different read.
- The dev/CI BYPASSRLS divergence for `/api/outputs/*` predates this change and design.md records it. This change does
  not widen it, because the app's own panel list already returns the Output id.

**AC5: RLS checked as `helio_app`.** All three new specs extend `TwoUserRlsApiFixture`, whose app pool is
`helio_app_test` (NOSUPERUSER NOBYPASSRLS). The labelled lines above come from my run.

**AC6 and the red-first point: are the red runs and mutations real?**
- `red-1-workspace-spec.txt`: 10 of 13 tests fail, at assertions, not at compilation. `red-seam.txt`: 1 of 1 fails.
  `red-mcp.txt`: 4 of 6 fail. The 2 that pass (owner/editor export, write-tool 403 passthrough) test behaviour that
  already existed.
- `mutate.py` shows the exact substitutions for m1-m5 and m8. Each saved transcript fails at its own assertion:
  - m1: `:155`, `:189`
  - m2: `:226`
  - m3: `:155`, `:207`, `:246`
  - m4: `:275`, `:325`
  - m5: `:299`, `:310`
  - m8: `:234`, `Some(pipelineId) was not equal to None`
  - m9: `SharedDashboardOutputRoutesRlsSpec:90`, `200 was not equal to 404`
  - m10: `:90` and `:109`
  - m11: `:343`, `"[Forbidden]"` vs the view-only text
  - m12: the prompt-rule test
  - m6 and m7 (helio-mcp) each fail exactly the tests they target.
- The evaluator noted that the line numbers are offset by 3 against today's spec. Today's assertions sit at 158, 192 and
  so on, the failure texts match, and the offset is consistent, so I accept the transcripts.
- m3 needs RLS removed as well before it goes red. That is consistent: RLS already hides public-only rows.

**AC7: `deploy-mcp.sh` named as the owner step.** This lives in the PR body, which does not exist yet. proposal.md
and design.md D4 commit to it. Delivery must include it (see notes).

**C15: grep of e2e/ and the helio-mcp tests.**
- No `"Forbidden"`, view-only or owner-only literal appears in `e2e/` or `helio-mcp/src`.
- The only frontend hits are two unrelated `new Error("Forbidden")` mocks.
- No e2e test checks the `dashboard, N panels` description or `DashboardEntry`. The `e2e/support/hel1756Seed.ts`
  `panelCount` hit is an unrelated seed parameter.
- In helio-mcp, `/api/dashboards` is asserted in tests only by `httpClient.test.ts` (path only, query not asserted) and
  the new test.
- The helio-mcp goldens stay green because `context.ts` leaves out `accessRole` when the server leaves it out.

**C17: the sibling HEL-1780's files.** `git diff --name-only` has no `PublicDashboardRoutes`, no `frontend/` path and
no per-panel route resolver. The two "Resolver" files are patch-set resolvers. `/panels` is only called and pinned by a
seam test.

**C18.** There is no migration in the diff.

**UI (step 4).** Skipped. No `frontend/**` file changed, and the only UI that reaches this behaviour is the assistant,
which needs a live model call (C16).

### Verdict: CONFIRM

### Non-blocking notes
- In `helio-mcp/src/tools/sharedDashboards.test.ts:25`, `VIEW_ONLY` is typed by hand and does not come from the
  backend. If the backend text changes, the MCP refusal test stays green. The backend REST test
  (`WorkspaceSharedDashboardsSpec:343`) does pin the text, so drift would still be caught there, but not across the
  seam.
- Several test names and docs still say "exactly Forbidden" after their assertions changed:
  - test names at `EditorGrantCoverageSpec.scala:147,174,199` and `PatchSetDashboardGrantSpec.scala:178,190,212,218,224`;
  - class docs at `EditorGrantCoverageSpec.scala:45` and `PatchSetDashboardGrantSpec.scala:50`.
  The evaluator raised this too.
- `DashboardService.exportSnapshot`'s viewer refusal now says "view-only access", although export is a read. The text
  is accurate, and D3 lists this site.
- PR body must:
  - state that the hosted connector reaches prod only via `deploy-mcp.sh` (an owner step), as AC7 requires;
  - name the dev/CI BYPASSRLS divergence for `/api/outputs/*`.
