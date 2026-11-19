## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD b2603ab7998f3e9b4bdca5089a18f89da16fdc8b (change dir untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

- (a) AskApiHarness app pool is non-BYPASSRLS: TRUE. `AskApiHarness extends OutputInsightApiHarness extends
  OutputHistoryApiHarness`; `OutputHistoryApiHarness.scala:77` creates `helio_app_test_output_history NOSUPERUSER
  NOCREATEDB NOCREATEROLE NOLOGIN` (no BYPASSRLS, so default NOBYPASSRLS), `:89` `SET ROLE` on the app pool, `:91`
  `ctx = new DbContext(appDb, db)`. D4's planned `rolbypassrls = false` probe is still the right guard.
- (b) AskSeamSpec's viewer case is dashboard-only: TRUE. `AskSeamSpec.scala:44,51`: `viewer = seedUser("beta")`, only
  `grantBoard(board, _, "viewer")`; no pipeline grant anywhere. Case at `:137`. The premise-validation file's
  "no seam case for a viewer exists" is wrong; design.md is right.
- (c) CitationChip `public` variant with no token: TRUE. `CitationChip.tsx` calls `fetchPublicProvenance(dashboardId,
  citation.panelId ?? insightPanelId, undefined)` -> `GET /api/dashboards/:id/panels/:panelId/provenance` with no
  params (`provenanceService.ts:44-53`). Server: `PublicDashboardRoutes.scala:194-205` gates on
  `aclDirective.authorizeResourceWithSharing("dashboard", ...)`, which admits owner/editor/viewer grants;
  `PublicPanelOutputResolver.resolvePanelOutput` requires an `OutputPanel` on that dashboard and reads the Output via
  `findByIdInternal`.
- (d) Popover in the public variant: no `/api/outputs`/`/api/pipelines` fetch or link. `useProvenancePopoverHost.tsx`:
  `pipelineHref` null when `isPublic`; pipeline-terminal subscription skipped when `isPublic`;
  `ProvenanceContent.tsx:161` renders the pipeline Link only for `authenticated`. Fetch is only the injected fetcher.
- (e) Public/share-token viewer does not mount the shell: TRUE. `/dashboards/:dashboardId/panels` ->
  `PublicDashboardViewerPage` outside `AppShell` (`AppRoutes.tsx:104`); its imports include no DashboardMetaRow,
  CommandBar or AskDrawer.
- D1 premise "list holds only owned + named-grant": TRUE. `DashboardRepository.findAllVisiblePaged` joins
  `granteeId === uid`; existing spec "A public-only grant is not listed". The meta-row kebab still renders for a viewer
  at `shareInKebab` tiers because "Open assistant" is always pushed (`DashboardMetaRow.tsx:119-129,235`).
- (f) Grantee panel items carry the Output id: TRUE, as `config.outputId` (not top-level). `PublicPanelListResolver`
  -> `PanelResponse.fromDomain` -> `OutputPanelConfig.responseJson` emits `outputId` regardless of role (only
  `ownerId`/`createdBy` are role-gated). Client: `OutputPanelConfig.outputId` (`panel.ts:185`).
  `state.panels` has `loadedDashboardId` + `status`, so "settled for that dashboard" is expressible.
- (g) Existing tests asserting Ask hidden for grantees: YES, three files.
  `e2e/hel1773-viewer-grantee-dashboard.spec.ts:333` (viewer `expectNoEditingControls` lists "Ask about this
  dashboard"), `:463` (editor Ask button count 0); `DashboardMetaRow.roles.test.tsx:77-83` ("an editor edits but
  neither shares nor asks"); `CommandBar.test.tsx:278` ("editor: ... no ask") and `:283` ("viewer: no kebab at all" —
  becomes false once a viewer gets the Ask item). Design names hel1773 e2e and "tests asserting Ask hidden"
  generically; task 1.3 covers it.
- AskPinBuilder: `AskPinBuilder.scala:23-26` pins only on `Right(Owner) | Right(Editor)` of `requireAccess("pipeline",
  ...)`. `AccessCheckerImpl.requireAccess` returns `Left(NotFound)` when the caller has no grant row on the pipeline.
- AskPanel shows `AskUpsell` when `tier === "free"` (`AskPanel.tsx:32-40`): D5 holds.
- useAskPin places a panel only when the caller owns the dashboard (`useAskPin.ts:55`), and fetches nothing on mount,
  so the "no /api/pipelines except the pin's own" carve-out is accurate.
- No existing spec contradicts the ADDED requirements (no owner-only Ask requirement in `openspec/specs/ask-ui` or
  `dashboard-grantee-access`); ADDED is the right delta type.
- Existing coverage D4 overlaps: `AskDataServiceSpec.scala:87,119,359` already cover a dashboard-only viewer's payload
  refusal and no-pin at service level on the same harness. D4 still adds the role probe and the history read.
- Product questions: none that need escalation. The editor-with-pipeline-grant pin and per-caller beta charging are
  existing, unchanged server rules. The ticket settles every other point the design touches.

### Verdict: REFUTE

### Change Requests

1. **The D3a mutation can never go red (design.md D3 (a), tasks.md 4.2).** The design says "make `AskPinBuilder`
   accept `Viewer` -> that case goes red". It won't. The seam `viewer` holds no pipeline grant, so
   `requireAccess("pipeline", ...)` returns `Left(NotFound)` and never `Right(Viewer)` (`AccessCheckerImpl`
   `requireAccess`, the `case None => Left(...)` arm). Accepting `Viewer` leaves `pin` null and the seam case green.
   Under C12 that is a recorded "mutation proof" that proves nothing. Replace it with a mutation that does reach the
   dashboard-only viewer's path, for example: the pin decision falls through to `Some(...)` on any result (`case _ =>
   Some(...)`), or the builder reads the dashboard grant instead of the pipeline grant. Fix tasks.md 4.2's
   "AskPinBuilder accepts Viewer ... -> seam red" the same way. If you keep "accepts Viewer" anywhere, label it as
   exercising only a pipeline-viewer case (for example `AskDataServiceSpec.scala:359`), never the seam viewer.

### Non-blocking notes

- D2: the unmatched-citation fallback has to happen in `AskAnswerCard`. `CitationChip` falls back to `insightPanelId`
  (`ask:dashboard:<id>`), so rendering a chip for an unmatched citation would request
  `/panels/ask:dashboard:.../provenance` and get a 404. The design already says to render a plain ordinal. Keep that
  as a unit assertion.
- D2 mapping key: match on `panel.config.outputId` for `type: "output"` panels. `outputId` is not a top-level panel
  field.
- The `public` variant suppresses `provenance_opened` telemetry (`provenanceTelemetry.ts`: returns early for
  `public`). Grantee chip opens will emit no event. HEL-1780's grantee chips behave the same way. Accept it, or note
  it, but don't let a test assume the event fires.
- D4 says "AskRoutesSpec (or a new AskGranteeRlsSpec)". Either is fine; name the one you chose in files-modified.
- `premise-validation.md` claims no seam viewer case exists. That is wrong (`AskSeamSpec.scala:137`). The design
  supersedes it.
