## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All 3 ticket ACs are traceable to implemented code and covered by passing tests:
  - Markdown panel with real content renders on apply — `buildNonDataConfig` (`DashboardProposalService.scala:180-189`) + `DashboardApplyProposalSpec` "apply markdown content..." test + browser-verified live (see Phase 3).
  - Bar chart with named axes applies as that type — `applyAppearance`/`buildChartAppearance` + `DashboardApplyProposalSpec` "apply chart appearance..." test + browser-verified live.
  - "No post-apply manual editing" for the Netflix-overview scenario — covered by the combination of content/appearance/metric-literal paths, all live-tested.
- All 25 tasks in `tasks.md` are marked done and match what's actually in the diff — verified file-by-file (schema, protocol, domain, repository, service, tests, frontend, MCP) against each task item; no partial or reinterpreted items found.
- No scope creep: diff touches exactly the files listed in `files-modified.md`, all within the ticket's stated impact area. Two out-of-scope gaps were found and correctly left unfixed with rationale (see Non-blocking Suggestions).
- No regressions: full `sbt test` (973/973) and `npm test` (763/763) pass; `PanelRepository.replace`'s whitelist gotcha was proactively closed for the *new* `metricLabel`/`metricUnit` columns (Decision 5), matching the HEL-292 precedent instead of repeating it.
- Schemas (`dashboard-proposal.schema.json`, `panel.schema.json`) updated in the same change as the code that uses them, per CLAUDE.md's "keep schema updates in the same change" rule; `check:schemas` drift check passes.
- Planning artifacts reflect final implementation: design.md Decisions 1-6 all verified against real code (see Phase 2); no artifact describes behavior that isn't what got built.

### Phase 2: Code Review — PASS
Issues: none blocking.

- **Design Decision 6 (chart/divider validation pre-creation) — verified to actually hold, not just documented.** Read `DashboardProposalService.scala:41-48`: `apply()` calls `validateStructure(proposal)` first and short-circuits to `Future.successful(Left(ServiceError.BadRequest(err)))` before `preValidateBindings`/`createAll` ever runs. `validatePanel` (lines ~63-76) runs `RequestValidation.validateChartType` for chart panels and `RequestValidation.validateDividerOrientation` for divider panels, both before any panel exists. Re-ran the actual atomicity guarantee live: `sbt test` includes "reject an invalid chartType and create nothing" and "reject an invalid divider orientation and create nothing" in `DashboardApplyProposalSpec`, both asserting `dashboardCount() shouldBe before` — passed. `applyAppearance` (lines 216-241) performs no validation of its own, consistent with the design's claim.
- Imports & Qualifiers (CONTRIBUTING.md, mechanical): `check:scala-quality` ran clean, 0 inline-FQN violations across the diff.
- File-size soft budget (informational, not a fail per CONTRIBUTING.md): `DashboardProposalService.scala` crossed the 250-line soft budget (170 → 274 lines). Flagged as non-blocking per CONTRIBUTING.md's own "informational only" framing, but worth a heads-up since it's the ticket's most-changed file.
- DRY: `buildDataConfig`/`buildNonDataConfig` cleanly split out of the old single-branch `buildCreateRequest`, matching the existing `dataTypeId`-branch pattern; `ChartAppearance.Default` mirrors the frontend's `DEFAULT_CHART_APPEARANCE` values exactly (byte-for-byte comparison of `PanelDetailModal.tsx:35-53` vs `model.scala:107-124`) — the acknowledged cosmetic-duplication risk in design.md is real but low-risk as documented.
- Readable/Modular: small, well-named private methods (`hasChartAppearanceFields`, `buildChartAppearance`, `applyAppearance`); each has a doc comment explaining its contract and referencing the design decision it implements.
- Type safety: `MetricPanelConfig.label/unit` are typed `Option[String]`, not opaque JSON, consistent with Decision 3's rationale (distinct from `aggregation`'s deliberate opacity). No new `any`/untyped escape hatches on the frontend (`MetricLiteral` interface, `getMetricLiteral` narrowing helper).
- Error handling: `MetricPanelConfig.Patch.decode` and `.decode` reject non-string/non-null values via `deserializationError`, matching the existing pattern for every other typed field in the file.
- Tests meaningful: `PanelSpec` covers decode/Patch.decode/applyPatch × (absent/null/present) for both `label` and `unit` — a real regression (e.g. reverting the `jsonFormat5` bump, or dropping a Patch branch) would fail these. `ApiRoutesSpec`'s two new tests specifically guard the Decision-5 whitelist gotcha via a **fresh repository re-read** (not the PATCH response), which is exactly the shape of bug that HEL-292's cycle-2 regression was.
- No dead code: no leftover TODO/FIXME, no unused imports in the diff.
- No over-engineering: `applyAppearance` reuses the existing `panelService.update`/`UpdatePanelRequest` machinery rather than introducing a new code path; the "no validation, best-effort" contract is a direct mirror of the existing `applyLayout` precedent, not a new abstraction.
- Behavior-preserving: `buildCreateRequest`'s refactor into `buildDataConfig`/`buildNonDataConfig` is behavior-preserving for existing data-panel proposals (same `baseFields`/`aggregation` logic, just relocated) — confirmed via existing `DashboardApplyProposalSpec` tests for pre-existing scenarios still passing unchanged.

### Phase 3: UI Review — PASS
Issues: none.

Servers started cleanly via `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` (PASS). Since this ticket has no manual-editor UI (explicit Non-Goal), verification exercised the actual delivery mechanism: `POST /api/dashboards/apply-proposal` with the new fields, then viewing the resulting dashboard in the browser (logged in as matt@helio.dev).

- **Happy path, end-to-end, live in the browser:**
  - Markdown panel with `content: "# Q3 Goals\n\n- Ship it\n- Verify it"` → rendered as a real `<h1>Q3 Goals</h1>` + `<ul><li>Ship it</li><li>Verify it</li></ul>`, not "No content yet."
  - Metric panel with `label: "Avg Rating (literal)"`, `unit: "pts"`, bound `value` → rendered `10 pts` / `AVG RATING (LITERAL)`, i.e. the literal override won over the (absent) fieldMapping label — Decision 4 confirmed visually, not just in a unit test.
  - Chart panel with `chartType: "bar"`, `xAxisLabel: "Rating"`, `yAxisLabel: "Score"`, `seriesColors: ["#ff0000", "#00aa00"]` → rendered as an actual **bar chart** (not the default line) with red bars, "Score"/"Rating" axis titles visible — Decision 2/6 confirmed visually.
  - Divider panel with `orientation: "vertical"` → created and rendered without error (`config.orientation` correctly persisted).
  - Screenshot evidence: full 4-panel dashboard at 1440px shows all four panels correctly rendered with no visual breakage.
- **Unhappy path:** re-ran (via `sbt test`, fresh execution, not just trusting the executor's report) `DashboardApplyProposalSpec`'s "reject an invalid chartType and create nothing" / "reject an invalid divider orientation and create nothing" — both pass, 400 + zero dashboards created.
- **Console:** 0 errors across the full flow (login, apply-proposal x2, dashboard view, panel render). One pre-existing warning (`selectPipelineOutputDataTypes` unmemoized selector) — confirmed via `grep` that this selector isn't touched by this diff; unrelated to this ticket.
- **Breakpoints:** resized to 1440 / 768 / 375 — panel grid reflows correctly at each, no overlap/breakage introduced by this change (this ticket touches no layout/grid code).
- **Entry point:** the only entry point for these fields is `POST /api/dashboards/apply-proposal` (MCP `apply_proposal` tool + in-app Proposal Review flow share this route per `DashboardProposalRoutes.scala`'s own doc comment) — exercised directly, which is the correct/only path per this ticket's Non-Goals (no manual editor).

### Overall: PASS

### Non-blocking Suggestions
- `DashboardProposalService.scala` crossed the 250-line soft budget (274 lines). Not a hard fail per CONTRIBUTING.md, but worth a proactive split next time this file is touched (e.g. extracting the `applyAppearance`/`buildChartAppearance`/`hasChartAppearanceFields` cluster into a small helper object).
- `specs/markdown-panel/spec.md`'s second scenario title ("Proposal chart/markdown panel with no content creates an empty panel") still has the copy-paste "chart/" artifact the skeptic flagged in round 2 as non-blocking — one-word fix (`chart/markdown` → `markdown`) whenever this file is next touched.
- Two out-of-scope spinoff candidates were correctly identified by the executor and left unfixed (verified both are real, pre-existing, and outside this ticket's task list):
  1. `frontend/src/features/dashboards/types/proposal.ts`'s `ProposalPanel` is still missing the HEL-292 `aggregation` field (confirmed via diff — this ticket's edit added the 9 new fields but did not touch/add `aggregation`). Worth a follow-up ticket since it's a real type-parity gap between frontend and backend/schema.
  2. `PanelMutationRepository.batchUpdate`'s config-column whitelist has the same gotcha `PanelRepository.replace` had for `aggregation` (now also `metricLabel`/`metricUnit`) — pre-existing, correctly scoped out of this ticket's Decision 5 (which only covers `replace`). Worth a follow-up ticket to audit `batchUpdate` the same way.
