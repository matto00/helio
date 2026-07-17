## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All three ACs addressed explicitly:
  - Selecting bar/pie/scatter in the creation modal produces that chart type on first render — verified live (see Phase 3): a chart panel created with `chartType: "bar"` selected returned `appearance.chart.chartType: "bar"` from the create response and the subsequent `GET /api/dashboards/:id/panels` read, with no follow-up PATCH.
  - `panelPayloads.test.ts` asserts `buildCreatePanelBody` carries `chartType` into `appearance.chart.chartType`, and the audited sibling fields (metric `valueLabel`→`config.label`, `unit`→`config.unit`) are also pinned, including the omit-when-empty case.
  - `TypeSelectStep.tsx` copy now names all four chart types ("line, bar, pie, or scatter") — confirmed in source, in the updated `PanelCreationModal.test.tsx` assertion, and live in the browser at both desktop and 390×844.
- No AC silently reinterpreted. The design doc explicitly documents and justifies going beyond the literal ask (D5 chartType-validation parity across all three appearance-write paths) as closing a corroborating gap found during the design gate, not scope creep — the ticket's own repro-widening note asked for exactly this kind of audit.
- All 12 task items in `tasks.md` are marked done and match the implementation verified in code and via test runs.
- No unnecessary changes outside ticket scope. The `DEFAULT_CHART_APPEARANCE` move (D3) is required to avoid duplicating the default composed by the new create path and is behavior-preserving (verified in diff — values are an exact copy, all consumers re-point to the shared export, full frontend suite green).
- No regressions: full frontend Jest suite (1113 tests) and full backend ScalaTest suite (1389 tests) pass fresh, including a targeted `ApiRoutesSpec` run.
- API contracts updated in the same change: `schemas/create-panel-request.schema.json` gains the optional `appearance` property (`$ref` to the existing `panel-appearance.schema.json`), matching `CreatePanelRequest`'s new field. Schema-parity check not separately scripted but the shape is verified to reuse the existing `PanelAppearancePayload` codec.
- Planning artifacts (proposal/design/tasks) reflect the final implemented behavior — cross-checked against the diff line by line; no drift found.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` reports "clean" (only pre-existing soft-budget line-count warnings, informational only). `PanelService.scala` (282→293 lines) and `PanelServiceHelpers.scala` (135→169 lines) both remain under the ~400-line hard-flag threshold that would require a proposed split; the increase is proportionate to the new `resolveCreateAppearance`/`validateBatchChartTypes` logic. No inline FQN violations introduced (checked via the mechanical script, not just eyeballing).
- No DESIGN.md violations — the only UI-visible diff is a copy string in `TypeSelectStep.tsx`; no new markup, tokens, or components were introduced.
- **DRY**: `defaultChartAppearance` is now the single source (D3), eliminating a duplicate; `normalizeAppearancePayload` is shared between create and PATCH paths (`PanelServiceHelpers.scala:47-58`) rather than being re-implemented per call site.
- **Readable**: `seedCreateAppearance`, `seedCreateConfig`, `resolveCreateAppearance`, `validateBatchChartTypes` are clearly named with doc comments explaining the HEL-305 rationale inline — no magic values.
- **Modular**: the chartType-validation logic is factored into small, reusable helpers rather than inlined at each call site.
- **Type safety**: no `any`/untyped escape hatches introduced; `PanelAppearance`/`PanelAppearancePayload` are properly typed end to end.
- **Security**: chart-type input is now validated against an allow-list on all three write paths (create/PATCH/batch) rather than accepted unchecked — this is a net security/data-integrity improvement, not a regression.
- **Error handling**: invalid chartType surfaces as a 400 with a message naming valid values on all three paths (verified live via ScalaTest and consistent error message assertions); batch validation runs pre-transaction so no partial writes occur (explicitly tested).
- **Tests meaningful**: new frontend/backend tests exercise the exact regression (chartType dropped from create), the sibling metric fields, the omit-when-absent branches, and the D5 validation parity (create/PATCH/batch, valid and invalid, with the no-partial-write batch case explicitly asserted by re-reading the panel after a rejected batch).
- **No dead code**: the old `DEFAULT_CHART_APPEARANCE` private const was fully removed, not left as an orphan; no leftover TODO/FIXME.
- **No over-engineering**: the `appearance` field is additive/optional and reuses the existing PATCH wire shape/codec rather than inventing a new one; D5's validation-parity scope was explicitly scoped down to "same validator, three call sites" rather than a broader appearance-validation rewrite.
- **Behavior-preserving refactor**: the `DEFAULT_CHART_APPEARANCE`→`defaultChartAppearance` move is an exact-value relocation (diff confirms no value drift) with the full Jest suite green as evidence.

Gates re-run fresh (not trusted from the executor's report):
- `npm run lint` — 0 warnings.
- `npm run format:check` — clean.
- `npm test` (frontend) — 103 suites / 1113 tests passed.
- `sbt "testOnly com.helio.api.ApiRoutesSpec"` — 177 tests passed.
- `sbt test` (full backend) — 72 suites / 1389 tests passed.
- `npm run check:scala-quality` — clean (soft warnings only, pre-existing).
- `npm run check:openspec` — flags "complete but not archived," the accepted, explicitly-called-out bypass reason for the `-n` commit (archival is a later workflow phase). No other gate failed.

### Phase 3: UI Review — PASS
Issues: none.

Servers started via `scripts/concertino/start-servers.sh` (DEV_PORT 5478 / BACKEND_PORT 8385); `assert-phase.sh servers` returned PASS.

- **Happy path (chart, first render)**: created a chart panel ("HEL-305 Bar Verify") selecting "Bar" in the creation modal. Fetched the dashboard's panels immediately after creation (no edit-pane interaction): `appearance.chart.chartType: "bar"` was present on the create response and the subsequent read — confirms the core AC end-to-end, not just at the unit-test level.
- **Metric seeding**: created a metric panel ("HEL-305 Metric Verify") with Value label "Net Profit" and Unit "USD". Fetched result: `config.label: "Net Profit"`, `config.unit: "USD"` — seeded correctly on first render.
- **Copy check**: `TypeSelectStep.tsx`'s chart card reads "Visualize trends with line, bar, pie, or scatter" live in the browser, both at desktop width and at 390×844 mobile.
- **Chart-type option list**: opening the combobox in the creation modal shows all four options (Line, Bar, Pie, Scatter).
- **No console errors** during the full flow (create chart, create metric, mobile navigation) — 0 errors reported by `browser_console_messages`. Pre-existing warnings (`selectPipelineOutputDataTypes` memoization, ECharts zero-dimension-DOM on a hidden preview) are unrelated to this change — the touched files are not the selector or the chart-preview sizing logic.
- **Mobile (390×844)**: creation modal renders without layout breakage at both the type-select step (four-type copy wraps cleanly) and the chart-type-select step (full-width select trigger, standard modal chrome). Per the design doc's explicit note, no new interactive controls were added by this change (the chart-type `<select>` is pre-existing, unmodified `ChartCreatorFields.tsx` — confirmed zero diff on that file), so the 44px touch-target rule is not a new-control trigger here; its ~32px trigger height is a pre-existing condition outside this ticket's scope.
- Not applicable/not re-verified: broader breakpoint sweep (1440/1100/768) and light-theme parity, since this change touches no new visual surface beyond one copy string and a payload/validation change with no rendering difference in the modal chrome itself. Skeptic subjective visual review is the appropriate owner for anything beyond the mechanical checks above.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `ApiRoutesSpec.scala` (4015 lines) is far over the soft budget; the executor's handoff already flags this as a reasonable spinoff rather than fixing it in this change — agreed, no action needed here.
- The pre-existing chart-type `<select>` trigger in `ChartCreatorFields.tsx` (creation modal) is ~32px tall, under the 44px touch-target guideline; out of scope for this ticket (control predates this change) but worth a follow-up ticket if mobile touch-target audits continue.
