## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `skeptic-design-1.md` and `skeptic-design-2.md` in full, and the current (twice-revised)
  `design.md`, `tasks.md`, `proposal.md`, `ticket.md`, `specs/panel-viz-aggregation/spec.md`, and
  `specs/echarts-chart-panel/spec.md`.

**Round-2 fix (merged-config check via `mergedAggregationPresent`) — verified sound, and safe to call
early:**
- Read `backend/src/main/scala/com/helio/services/ProposalPanelSupport.scala` in full.
  `buildCreateRequest(dashboardId, panel)` (line 95) uses `dashboardId` **only** to populate the
  `dashboardId` field of the returned `CreatePanelRequest` (line 102) — it plays no role whatsoever in
  computing `derived`/`configOpt` (lines 96-100, `buildDataConfig`/`buildNonDataConfig`/`mergeConfig`).
  So calling `buildCreateRequest` from inside `validatePanel` (which runs in `DashboardProposalService
  .validateStructure`, confirmed at `DashboardProposalService.scala:54`, and `DashboardContentsService
  .validatePanels` at `DashboardContentsService.scala:40` — both strictly *before* any dashboard exists,
  i.e. before a real `DashboardId` is available) with a placeholder/dummy `DashboardId` is safe and
  produces the exact same `.config` JSON the real create call will later produce. This closes round 2's
  finding correctly — `mergeConfig`'s `JsObject(d.fields ++ c.fields)` (passthrough wins on conflict, line
  119) means the resolved `config`'s `"aggregation"` key reflects whichever of the flat field / passthrough
  actually wins, exactly matching what `ChartPanelConfig.decodeCreate` will read.
- Confirmed `validatePanel`'s current signature is `(where: String, panel: ProposalPanel)` — no
  `dashboardId` parameter yet exists, so this will need a signature change or an inline dummy value at both
  of `validatePanel`'s two call sites. This is a small, mechanical implementation detail an implementer can
  fill in trivially (e.g. a constant sentinel `DashboardId`) — not a design flaw, since I confirmed the
  value is provably inert for this purpose. Non-blocking.

**New finding — a completely distinct, real write path this design never traces at all: dashboard snapshot
import (`POST /api/dashboards/import`) can create a scatter+aggregation chart panel with zero validation:**
- Confirmed the route is live: `backend/src/main/scala/com/helio/api/routes/DashboardSnapshotRoutes.scala:33`
  wires `path("import")` to `dashboardService.importSnapshot(payload, user)` — an authenticated,
  client-reachable endpoint (this is the backing of the app's dashboard-import/duplicate-via-file feature,
  not a test-only or internal path).
- `DashboardService.importSnapshot` (`DashboardService.scala:218-227`) calls only
  `validateSnapshotPayload` (→ `DashboardServiceValidation.validateSnapshotPayload`,
  `DashboardServiceValidation.scala:23-29`), which in turn calls `validatePanelEntries`
  (`DashboardServiceValidation.scala:49-58`). That function calls **only**
  `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` — a per-subtype *shape* decoder
  that verifies `config` parses into the right typed config, nothing more. I confirmed
  `PanelConfigCodec.decodeCreateConfig` (`PanelConfigCodec.scala:55`) never calls `ChartPanel.validateConfig`
  or any cross-field check, and `ChartPanel.validateConfig` itself (`ChartPanel.scala:300`) is the
  hardcoded `Right(())` this ticket is extending — but nothing in the import path ever calls it.
- After validation passes, `dashboardRepo.importSnapshot` (`DashboardSnapshotRepository.scala:135-206`)
  builds each panel directly from the wire payload: `appearance = PanelAppearance(..., chart =
  entry.appearance.chart)` (line 174-179, carrying `chartType` verbatim from the client-supplied
  `DashboardSnapshotPanelEntry.appearance`) and, for a chart entry, `ChartPanel(panelId, dashId,
  entry.title, meta, appearance, ownerId, c)` (line 186) where `c` is the `ChartPanelConfig` decoded
  straight from the client-supplied `entry.config` (which carries `aggregation` verbatim — confirmed
  `ChartPanelConfig.decodeCreate` reads `aggregation` off exactly this JSON, per round 2's own trace of the
  same decoder). The resulting `Panel.validateConfig` is **never called anywhere in this method or in
  `DashboardService.importSnapshot`** — the row goes straight to `panelTable += pr` (line 201) inside a
  `transactionally` DB action. This is a completely separate call graph from `PanelService.buildForCreate`,
  `PanelService.update`, `PanelService.batchUpdate`, and `ProposalPanelSupport.validatePanel` — the four
  enforcement sites D2 names — and none of them are anywhere on this path.
- Concrete exploit: an authenticated caller POSTs `{"version": 2, "dashboard": {...}, "panels": [{
  "snapshotId": "p1", "title": "...", "type": "chart", "appearance": {"chart": {"chartType": "scatter",
  ...}}, "config": {"dataTypeId": "...", "fieldMapping": {...}, "aggregation": {"groupBy": "region", "agg":
  "sum", "yField": "sales"}}}], ...}` to `POST /api/dashboards/import`. `validateSnapshotPayload` passes
  (the config shape is valid `ChartPanelConfig` JSON; `aggregation` is an accepted, untyped `JsObject`
  field with no shape/cross-field validation, per design.md's own "Context" section). The dashboard and the
  scatter+aggregation chart panel are both created, in one DB transaction, with **no error at all** — the
  exact "silent ignoring" failure mode the ticket exists to rule out, on a real write path this design
  never mentions, considers, or lists as in- or out-of-scope. I grepped `design.md`/`tasks.md`/`proposal.md`
  for "import"/"snapshot" — zero matches; this path was never traced in any of the three design rounds.
- This is not a restatement of round 1 (apply-proposal appearance-not-carried-at-create) or round 2 (config
  passthrough bypassing the flat-field check inside `ProposalPanelSupport`) — it is a structurally different
  write path (`DashboardSnapshotRepository`, reached via `DashboardService`/`DashboardSnapshotRoutes`, not
  `PanelService` or `ProposalPanelSupport` at all) that both prior rounds' fixes leave completely
  untouched, and it is exactly the kind of "OTHER passthrough or override path" the orchestrator's brief
  for this round explicitly asked me to hunt for.

**Sanity-check of D1/D3/D4/D5 (unchanged since round 1/2):**
- Re-read `ChartPanel.tsx:190-220` — `useAggregate`/`isPie`/`buildAggregateDataOption` branch structure is
  unchanged and still matches D1's description verified in round 1.
- D3/D4/D5 touch no files that changed in this revision (only the D2 ProposalPanel-paths bullet and
  tasks.md 1.3a/5.6 changed per the round-2 diff); no new contradiction found on re-skim.

### Verdict: REFUTE

### Change Requests

1. **Cover `POST /api/dashboards/import` (`DashboardService.importSnapshot` /
   `DashboardSnapshotRepository.importSnapshot`) — a real write path this design has never traced, on
   which a chart panel can be created with `chartType: "scatter"` + a populated `config.aggregation` with
   zero validation.** `DashboardServiceValidation.validatePanelEntries`
   (`DashboardServiceValidation.scala:49-58`) only shape-decodes each panel's `config` via
   `PanelConfigCodec.decodeCreateConfig`; it never calls the new `ChartPanel.validateConfig`/
   `rejectsAggregation` check, and `DashboardSnapshotRepository.importSnapshot` builds and persists the
   `ChartPanel` domain object directly (line 186) with the client-supplied `entry.appearance.chart` and
   `entry.config` — bypassing `PanelService` entirely. Required revision: add a fifth enforcement point.
   The most direct fix is extending `validatePanelEntries` to, for each `type == "chart"` entry, decode the
   entry's `config` (already being done) and cross-check its `aggregation` presence against
   `entry.appearance.chart.chartType` using the same `ChartPanel.rejectsAggregation` predicate D2
   introduces — this is a natural fifth call site (a "pre-write, per-entry, zero-side-effect pre-pass,"
   exactly the pattern `validatePanelEntries` already is) and should be named explicitly in D2 alongside the
   other four. Update `design.md`'s D2 (goals bullet and enforcement-sites list), `tasks.md` (a new task,
   e.g. 1.6, plus a `proposal.md`/`ticket.md`-referenced write-path count correction — the proposal
   currently lists "single, batch, and replace-contents paths" for the reject case, which should become
   "single, batch, replace-contents, apply-proposal, and import" to match D2's own five-site list), and add
   a test to section 5 asserting a snapshot import containing a scatter+aggregation chart panel entry 400s
   the entire import with zero dashboard/panel rows created (mirroring the zero-write guarantee already
   required of the other pre-write checks).

### Non-blocking notes

- The round-2 fix (`mergedAggregationPresent` via `buildCreateRequest(dashboardId, panel).config`) is
  correctly specified and verified safe against the real `ProposalPanelSupport.scala` — calling
  `buildCreateRequest` with a not-yet-real `dashboardId` purely to inspect `.config` is provably inert
  (the parameter is never read except to populate the returned request's own `dashboardId` field).
- `validatePanel`'s signature will need a `dashboardId` parameter (or an inline dummy constant) to make the
  round-2 fix callable — a trivial mechanical detail, not called out explicitly in tasks.md 1.3a's prose,
  but not worth blocking on given it's unambiguous how to fill it in and provably safe either way.
- Duplicate-dashboard (`DashboardSnapshotRepository.duplicate`) copies existing persisted panel rows
  verbatim and was not flagged as a new gap — it only perpetuates whatever state a panel was already
  validated (or grandfathered) into at creation time, which is the same "legacy stray row" scope D3
  already covers, not a fresh write of a new combination.
