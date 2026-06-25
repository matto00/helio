## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues:
- All four ACs addressed: new `findLastRunAtByOutputDataTypeId` repository method (AC #1), `dataAsOf` field on `PanelResponse` (AC #2), frontend freshness indicator using `formatRelativeTime` (AC #3), indicator hidden for unbound/never-run panels (AC #4).
- All 17 tasks marked `[x]` and match what was implemented.
- No scope creep. Changes are focused entirely on the ticket.
- No regressions to existing panel behavior — `PanelResponse.fromDomain` default param (`None`) preserves backward-compat for all non-`PublicDashboardRoutes` callers.
- `schemas/panel.schema.json` updated with `dataAsOf` property.
- OpenSpec artifacts (design, tasks, specs) accurately reflect the final implementation including the Skeptic-negotiated fix (`'succeeded'` not `'success'`).

### Phase 2: Code Review — PASS
Issues:
- No CONTRIBUTING.md violations. Inline imports in `ApiRoutesSpec.scala` (e.g. `import slick.jdbc.PostgresProfile.api._` inside test bodies) follow a pre-existing pattern in that file — confirmed present on `main` at lines 82, 781, 824, etc. The new HEL-234 tests follow the same pattern rather than introducing it.
- `DataTypeId` was correctly promoted to the top-level import in `PipelineRepositorySpec.scala` rather than inlined — correct.
- `PipelineRepository.findLastRunAtByOutputDataTypeId` uses `withSystemContext` per design D2, with a comment explaining the ACL rationale — matches CONTRIBUTING.md's `findByIdInternal` pattern requirement.
- No hardcoded colors/spacing/typography in the new `.panel-grid-card__freshness` CSS rule. Uses `--app-text-muted` (color token), `--space-1` (spacing token), `--text-xs` (type token) — DESIGN.md [mechanical] rules satisfied.
- `PanelResponse.fromDomain` default-param approach is clean and DRY. All 5 non-`PublicDashboardRoutes` call sites updated to explicit eta-expansion (required by the added default param).
- The `Future.sequence` concurrent lookup in `PublicDashboardRoutes` is correct and follows the design's stated risk mitigation for N+1.
- Tests are meaningful: `PipelineRepositorySpec` covers 5 scenarios (happy path, never run, failed run, unknown DataTypeId, multi-pipeline max). `ApiRoutesSpec` covers the full round-trip. `AggregatorRegressionSpec` covers JSON round-trip for both `Some` and `None`.
- No dead code, no unused imports, no TODOs/FIXMEs introduced.
- File sizes all within budget.

Non-blocking observation: Spray JSON's `jsonFormat9` serializes `dataAsOf: Option[String] = None` as a field-absent response (field not emitted at all) rather than `"dataAsOf": null`. This is consistent with how all other `Option` fields in the codebase behave (e.g., `chart: Option[ChartAppearance]` in `PanelAppearanceResponse` is also omitted when `None`, confirmed via API inspection). AC #2 says "null otherwise" but the field is absent — minor spec/wire discrepancy. The JSON schema does not list `dataAsOf` in `required` so the response is JSON-Schema-valid. The frontend `panel.dataAsOf ? ...` falsy check correctly handles both `null` and `undefined`, so behavior is correct. This is pre-existing codebase convention, not a defect introduced by this change.

### Phase 3: UI Review — PASS

#### Setup
Servers started via `scripts/orchestrator/start-servers.sh` at DEV_PORT=5407, BACKEND_PORT=8314. Both healthy.

#### Evidence gathered
- Manually set ProfitAgg pipeline to `last_run_status = 'succeeded'` in dev DB to create a panel with a bound DataType whose pipeline has run.
- Dashboard "Helio Roadmap (copy)" contains "Helio is profitable?" (chart bound to ProfitAgg output DataType) — confirmed `dataAsOf` returned as ISO timestamp in API response.
- API response verified via `curl`: `dataAsOf: "2026-06-14T00:19:41.838246Z"` present for the bound+succeeded panel.

#### Checks

- [x] **Happy path — bound panel with succeeded pipeline**: "Helio is profitable?" panel displays "Data as of 54 seconds ago" below the panel title. Indicator renders in correct location (below `<h3>`), uses muted styling.
- [x] **Unhappy path — unbound panel**: "Jan 2026 Profit" (metric, bound to DataType with no associated pipeline) and all markdown panels show no freshness indicator. Confirmed via DOM query returning 0 `.panel-grid-card__freshness` elements on unbound panels.
- [x] **Unhappy path — pipeline with only failed runs**: Restored ProfitAgg to `failed` status; 0 freshness indicators render on the dashboard.
- [x] **No console errors**: Only pre-existing errors observed (`https://test/snap.png` broken seed image, `401` from auth state check, `500` from a different worktree's backend). No errors attributable to this change.
- [x] **Breakpoints**: Indicator rendered correctly at 1440, 1100, 768, and 400px viewport widths.
- [x] **Accessibility**: The `<p class="panel-grid-card__freshness">` element contains readable text; no interactive elements introduced that require ARIA labels.
- [x] **Loading states**: Not applicable (indicator renders inline with panel data; no separate loading state needed).

### Overall: PASS

### Non-blocking Suggestions
- The `dataAsOf: null` vs. absent-field discrepancy (described in Phase 2) is worth a future follow-up: a custom `RootJsonFormat` for `PanelResponse` that explicitly writes `JsNull` for `None` would make the wire format match the spec literally. Not a blocking defect — behavior is correct and consistent with existing codebase patterns.
