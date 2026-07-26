## Skeptic Report — design gate (round 4)

### What I verified (with evidence)

- Read `skeptic-design-1.md`, `-2.md`, `-3.md` in full, and the current (four-times-revised) `design.md`,
  `tasks.md`, `proposal.md`, `ticket.md`, and both spec deltas.

**Round-3 fix (5th enforcement site: `DashboardServiceValidation.validatePanelEntries` for
`POST /api/dashboards/import`) — verified correct end-to-end, no divergence risk:**

- Confirmed `DashboardService.importSnapshot` (`DashboardService.scala:218-227`) calls
  `validateSnapshotPayload` **synchronously** and only reaches `dashboardRepo.importSnapshot` (the actual
  DB write, wrapped `.transactionally`) in the `Right` branch — a true zero-write pre-pass, matching
  design.md's claim.
- Confirmed `validateSnapshotPayload` → `validatePanelEntries` (`DashboardServiceValidation.scala:23-58`)
  runs `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` per entry — the exact call
  site task 1.6 targets.
- Confirmed the typed-value claim precisely: `DashboardSnapshotPanelEntry.appearance: PanelAppearancePayload`
  (`DashboardProtocol.scala:77-84`) has `chart: Option[ChartAppearance]` (`PanelProtocol.scala:10-14`), and
  `ChartAppearance.chartType: Option[String]` (`domain/model.scala:122-128`) — so
  `entry.appearance.chart.flatMap(_.chartType)` really is a clean, already-decoded `Option[String]`, not raw
  JSON. Confirmed `PanelConfigCodec.decodeCreateConfig`'s `ChartCreate(config: ChartPanelConfig)`
  (`PanelConfigCodec.scala:44,59`) wraps a fully-typed `ChartPanelConfig` whose `aggregation: Option[JsObject]`
  (`ChartPanel.scala:181-184`) is the decoded field.
- Confirmed there is **no passthrough/merge step** on this path (unlike `ProposalPanelSupport`): read
  `DashboardSnapshotRepository.importSnapshot` (`DashboardSnapshotRepository.scala:135-190`) in full — it
  builds `appearance = PanelAppearance(..., chart = entry.appearance.chart)` verbatim from the same
  `entry.appearance` the validator will see, and independently re-runs
  `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` on the same `entry.config` to build
  the persisted `ChartPanelConfig`. Both the validator and the repository decode from the identical two
  wire fields (`entry.appearance`, `entry.config`) with the identical decoder — there is no separate
  flat-field-vs-generic-passthrough merge step here the way `ProposalPanelSupport.buildCreateRequest`'s
  `mergeConfig` has (round 2's bug class). The round-3 fix as specified in design.md/tasks.md 1.6 cannot
  diverge from what gets persisted.

**Hunted again for any write path not among the five named sites — none found:**

- Enumerated every panel-mutating route in `PanelRoutes.scala`: `batchUpdate` (site 4), `batchCreate` (site
  1), `create` (site 1), `update` (site 3), `duplicate` (verified below). No sixth route exists.
- Enumerated every dashboard-level panel-mutating call in `DashboardRoutes.scala` /
  `DashboardSnapshotRoutes.scala`: `create` (empty dashboard, no panels), `duplicate` (verified below),
  `update` (dashboard-level appearance/layout only, no panel config), `importSnapshot` (site 5). Confirmed
  `DashboardContentsOps.replaceContents` (`DashboardContentsOps.scala:16-29`, doc comment) is a pure
  post-validation repo write — "`DashboardContentsService` (services layer) validates every panel BEFORE
  calling this method, with zero DB writes" — consistent with site 2's coverage.
- **Dashboard duplicate** (`DashboardSnapshotRepository.duplicate`, lines 28+) and **panel duplicate**
  (`PanelMutationRepository.duplicate`, lines 23+): read both in full. Both operate via `.copy(...)` on an
  **already-persisted row** fetched by ID (`source.copy(id=..., title=..., ...)` /
  `sourceRow`-derived `newPanelRows`) — neither accepts or decodes any new client-supplied `appearance`/
  `config` JSON. They cannot introduce a *new* scatter+aggregation combination that wasn't already present
  (and, if present, already validated at its original creation or grandfathered as a pre-fix legacy row,
  which D3 explicitly covers). Confirmed this is not a sixth bypass — consistent with round 3's own
  non-blocking note.
- **MCP write paths**: read `helio-mcp/src/tools/write.ts`'s `create_panel`/`create_panels` and
  `helio-mcp/src/helioApi.ts` in full for every `this.http.post(...)` call site (`grep` of all `"/api/..."`
  literals in `helioApi.ts`). Every MCP write funnels to one of: `POST /api/panels`, `POST /api/panels/batch`,
  `POST /api/panels/bound`, `POST /api/dashboards/apply-proposal` — no MCP-specific import/duplicate/
  replace-contents tool exists today, and none of the existing MCP write tools hit a route not already
  covered by one of the five named sites. There is no distinct MCP write path.
- **Demo/seed data** (`DemoData.scala`): both `ChartPanel(...)` literals use `emptyChart` (no `chartType`,
  no `aggregation` set) — no scatter+aggregation combination is seeded, so this isn't a live concern even
  though it technically constructs `ChartPanel` outside `PanelService`.
- Net: this is a complete accounting of every panel-appearance/config-mutating code path in the backend.
  No new, previously-untraced write path was found. Rounds 1-3's cumulative fix set (sites 1-5) is now
  exhaustive against the real route table.

**Scope-framing check (design.md Non-Goals / Risks, proposal.md, spec.md) — accurate, does not overclaim:**

- design.md's Non-Goals explicitly states the import fix is scoped to "exactly ONE cross-field check ...
  scoped to the scatter+aggregation rule this ticket owns" and that chartType-enum validity and any other
  cross-field rule "stays unenforced on import after this ticket ships," naming the HEL-344-tracked spinoff.
  proposal.md's Impact section repeats this framing. The new spec.md requirement text ("This requirement
  covers only the scatter+aggregation combination; it does not require dashboard-snapshot import to
  validate any other cross-field rule...") is consistent and non-misleading — a future reader cannot
  reasonably conclude import is now generally validated from these artifacts.
- proposal.md's write-path enumeration ("single create, batch create, replace-contents, apply-proposal,
  single update, batch update, and dashboard-snapshot import") now matches D2's five-site list; the
  round-3-flagged count mismatch is fixed.

**Sanity-check of D1/D3/D4/D5 (unchanged in substance since round 1, independently re-verified in rounds
1-3) — no contradiction introduced by the accumulated D2/Non-Goals/Risks edits:**

- D1 (pie data shape) and D4 (UI hiding)/D5 (discoverability) touch no files altered in this round's diff
  (only D2's import bullet, the new Non-Goals bullet, and the corresponding Risks bullet changed); re-read
  each in full — no internal contradiction with the revised D2 or with each other.
- D3 (backward compat: pie renders differently, scatter doesn't) is still consistent with the new
  import-scenario spec text ("A pre-existing scatter+aggregation panel keeps rendering raw points" —
  matches D3 verbatim, and correctly scoped to reads/renders, not writes).
- `specs/echarts-chart-panel/spec.md` confirmed unchanged since its initial commit (`git log` shows a
  single commit touching that file) — consistent with proposal.md's claim it needs no further edits this
  round.

### Verdict: CONFIRM

No new, previously-untraced write path was found, and the round-3 fix (import enforcement site) is
correctly targeted, uses already-typed values with no merge/passthrough divergence risk, and is properly
scoped in the Non-Goals/Risks sections so it won't be misread as general import validation. The design is
sound and ready for implementation.

### Non-blocking notes

- None beyond what's already captured in design.md's own Risks section (the pre-existing apply-proposal/
  replace-contents chartType-propagation gap and the general import-validation gap are both already
  correctly flagged as out-of-scope/spun-off, not silently ignored).
