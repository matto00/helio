## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c7d5582af5e314f8277125745de7fabac91b195d` against a base resolved live with `resolve-review-base.sh`
(`27b4a7402e0135322c2fcac1aeba16540ddce0a4`). The worktree was clean.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (search and context include shared dashboards with the role): `WorkspaceContextService.assemble` and
  `WorkspaceSearchService.find` read `DashboardService.findAllVisible`, which is HEL-1773's `findAllVisiblePaged`.
  `getResource(Dashboard)` reads the new `DashboardRepository.findVisibleWithRole`. That method uses the same
  owned-or-named-grant join, runs in `withUserContext`, and returns `None` for a public-only grant. The wire carries
  `accessRole`, and the schema lists it as required with an enum.
- AC2 (no viewer edits, no owner-only actions for an editor): the prompt rule is in place, and the server is the
  authority. Every site on the patch-set resolver path and the MCP write path refuses with a named 403 message. I
  enumerated the remaining bare `Forbidden()` sites myself:
  - `DashboardService:186` (duplicate) and `:255` (layout repair) are owner-only and outside the MCP write path, as the
    design allows.
  - `OutputService:148` and the pipeline resolvers are pipeline-scoped.
  - `AccessCheckerImpl.requireOwnerOnly` is used only by sharing and share tokens. helio-mcp has no tool for either
    (checked by grep).
- AC3 (helio-mcp list, read and write): `listDashboards` sends `include=shared`. `getDashboard` takes a viewer branch
  through the paged `/panels` route. `context.ts` carries `accessRole`. Write tools have no client-side guess and
  surface the server's 403 through `guarded`.
- AC4 (no payload rows or `/api/outputs/*` for a dashboard-only grant): `getResource(DataType)` stays `findByIdOwned`.
  `dashboardPanels` keeps `OutputReadAccess.readablePipelineId`. The D5 item 6 routes return 404 for the viewer and
  the editor, with the owner positive control (see Phase 2).
- AC5 (RLS checked as `helio_app`): all new specs run on `TwoUserRlsApiFixture`, whose app pool is `helio_app_test`
  created `NOSUPERUSER NOBYPASSRLS` (`TwoUserRlsApiFixture.scala:126-144`).
- AC6 (tests fail first): `red-1-workspace-spec.txt` (10 of 13 red), `red-seam.txt` and `red-mcp.txt` (4 of 6 red) all
  fail at assertions.
- AC7 (`deploy-mcp.sh` is the owner step): this is a PR-body item for the delivery phase. It is noted in proposal.md
  and design.md D4.
- tasks.md is fully checked and matches the diff. The spec delta's scenarios match the implemented behaviour. No
  migration (C18). No file owned by HEL-1780 is edited (C17): `/panels` is only called and pinned by a seam test.
- `workflow-state.md` has an empty `CONSTRAINTS` list, so nothing extra applies.

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates, run fresh by me in WORKTREE_PATH:**
- `nice -n 19 sbt -J-Xmx3g testFull`: 10008 succeeded, 0 failed, 5 canceled, 737 suites, 0 aborted, exit 0.
  - The `[HEL-1785 RLS]`, `[HEL-1785 RLS6]` and `[HEL-1785 SEAM]` lines from my own run match
    `rls-helio-app.txt` item for item.
  - D5 items 1-5: the viewer, editor, stranger and owner roles and counts; `find`; `getResource` with
    `outputPipelineId` `None`; stranger and public-only NotFound; `getResource(DataType)` viewer=false, editor=false,
    owner=true; propose_patch_set refusals with `proposal=None`.
  - D5 item 6: as both the viewer and the editor, `/:id`, `/rows`, `/history`, `/history/:point/rows`,
    `/distinct-values` and `/insight` all return 404. The pipeline owner gets 200 on every one, with non-empty rows,
    the payload, distinct values and a non-null render.
- `npm run lint` passed. `npm run format:check` passed.
- `npm run check:schemas`: in sync, 153 schemas checked.
- `npm --prefix helio-mcp run typecheck` passed.
- Root jest, 3 workers: 70 suites and 617 tests passed, including `helio-mcp/src/tools/sharedDashboards.test.ts`.
- `npm run check:scala-quality`: clean (soft size warnings only). `npm run check:openspec`: clean.
- I did not run frontend jest or the frontend build because no `frontend/**` file changed.

**Mutations (verified from transcripts against code and assertions; I did not re-run them, because this role never
modifies code):**
- m1-m8 and m10 are each red at the assertion that the mutation targets, and `mutate.py` shows the exact substitutions
  for m1-m5 and m8.
- m9 is red at the RLS-only routes. `/insight` stays 404 under m9, as the design expects.
- m11 (REST message) is red at `WorkspaceSharedDashboardsSpec.scala:343`. m12 (prompt rule) is red at the prompt test.
- Provenance note: m1-m8 were captured against an earlier revision of `WorkspaceSharedDashboardsSpec`. Their reported
  lines (155, 189, 207, 226, 234, 246) are a consistent 3 lines above today's assertions (158, 192, 210, 229, 237,
  249), and the failure texts match today's assertions exactly. The assertions are unchanged; I accept the transcripts
  and record the offset.
- The REST-message and prompt-rule tests were added after the first red run, and m11/m12 are their failable proof.
- m3 only goes red when both the app-level grantee filter and RLS are removed. That is consistent with RLS already
  hiding public-only rows on the app pool. The app-level filter itself (`p.granteeId === uid`) is plainly correct and
  shared with HEL-1773's proven `findAllVisiblePaged`.

**C15 grep (e2e/, helio-mcp/src, frontend/src, backend tests):**
- No e2e, helio-mcp or frontend assertion uses `"Forbidden"` for the changed sites. The two frontend hits are
  unrelated `new Error("Forbidden")` mocks in the assistant conversation tests.
- Backend `"Forbidden"` assertions tied to the changed sites were updated deliberately (`ApiRoutesSpec`,
  `EditorGrantCoverageSpec`, `PatchSetDashboardGrantSpec`). The ones that remain are pipeline, output or owner-only
  checks, unchanged by design.
- No frontend or e2e consumer of `/api/workspace/context` or `WorkspaceContextDashboard`.
  `frontend/src/features/dashboards/types/dashboard.ts:79` is the unrelated `DashboardSnapshotDashboardEntry`.

**Code quality:**
- The messages live in one place (`DashboardAccessMessages`) and the status codes are unchanged.
- No inline FQNs, no `any`, no dead code.
- The MCP viewer branch pages until `total` and guards against an empty page.
- `context.ts` omits `accessRole` when an older server omits it, which is reasonable degradation.

### Phase 3: UI Review — N/A
- The only matching trigger is `schemas/workspace/workspace-context.schema.json`, and nothing consumes it in the
  frontend (grep above). The diff has no `frontend/**` change.
- The one in-app surface that reaches this behaviour is the assistant, and exercising it needs a live model call,
  which C16 forbids. The behaviour is covered on the fake transport through the tool executor.
- No servers were started.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Several existing test names now describe the old behaviour: `EditorGrantCoverageSpec.scala:147,174,199` and
  `PatchSetDashboardGrantSpec.scala:178,190,212,218,224` still say "with exactly Forbidden". The class docs at
  `EditorGrantCoverageSpec.scala:45` and `PatchSetDashboardGrantSpec.scala:50` still say "exactly
  `Left(ServiceError.Forbidden())`". Rename them, for example to "with the view-only refusal".
  `EditorGrantCoverageSpec.scala:234` (the Output create case) is correctly unchanged.
- `DashboardService.exportSnapshot`'s viewer refusal now reads "You have view-only access to this dashboard". The
  message is accurate, but export is a read. For MCP callers of `getDashboardSnapshot` (the output-controls tools), a
  more specific text such as "Export is not available with view-only access" might read better. This is optional, and
  design D3 did list this site.
- `helio-mcp/src/helioApi.ts` is 1492 lines, well over the soft budget. That predates this change (+52 lines here).
  Consider proposing a split in the PR description, as CONTRIBUTING.md asks for files over about 400 lines.
- PR body: state that the hosted connector reaches prod only via `deploy-mcp.sh` (an owner step), and name the dev/CI
  BYPASSRLS divergence for `/api/outputs/*` that the design records.
