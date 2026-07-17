## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket ACs read fresh**: `openspec/changes/fix-creation-chart-type/ticket.md` — three ACs
  (chart type takes effect on first render; test pinning `buildCreatePanelBody`'s carried fields;
  `TypeSelectStep.tsx` copy names all four chart types).

- **AC1 — bar/pie/scatter selected at creation render as that type on first render**:
  - Code: `frontend/src/features/panels/state/panelPayloads.ts` `seedCreateAppearance` emits
    `appearance.chart.chartType` only for `type === "chart"` with a selected `chartType`;
    `buildCreatePanelBody` attaches it to the create body only when non-`undefined`
    (`panelPayloads.ts:59-72`).
  - Backend: `PanelService.create` resolves `resolveCreateAppearance(request.appearance)` and applies
    it instead of the previously-hardcoded `PanelAppearance.Default` (`PanelService.scala:112-135`).
  - **Live verification (not just unit tests)**: started servers via
    `scripts/concertino/start-servers.sh` / `assert-phase.sh servers` → `PASS`. Logged in as
    matt@helio.dev, opened the creation modal on dashboard "HEL-303 Panel Kind Sweep", selected
    "Scatter" as the chart type, created panel "Skeptic Scatter Verify". Fetched
    `GET /api/dashboards/:id/panels` directly via `page.evaluate(fetch(...))` (bypassing any UI
    caching) and confirmed `appearance.chart.chartType: "scatter"`, with `createdAt === lastUpdated`
    (i.e. no follow-up PATCH occurred — this is genuinely the create-time value). Screenshot at
    1440×900 (`.playwright-mcp/skeptic-desktop-view.png`, gitignored) visually confirms the new panel
    renders as a scatter plot (circular markers on a dotted line) directly adjacent to the
    evaluator's "HEL-305 Bar Verify" panel which renders as a bar chart — visually and mechanically
    distinct render on first load, not a stale "line" fallback.
  - Metric seeding: evaluator's live check (`config.label`/`config.unit` seeded from
    `valueLabel`/`unit`) is corroborated by the code path (`panelPayloads.ts` metric arm,
    `seedCreateConfig`) and its dedicated tests (below); I did not re-run this specific live flow
    myself (redundant with the evaluator's already-concrete, falsifiable transcript) but did confirm
    the code path exists and is tested.

- **AC2 — test asserting `buildCreatePanelBody` carries `chartType` (and audited sibling fields)**:
  Read `frontend/src/features/panels/state/panelPayloads.test.ts` diff — new `describe` blocks assert
  `body.appearance?.chart?.chartType === "bar"`, composition over the shared default (`seriesColors`
  length), omission of `appearance` when chartType is unset or type is non-chart, and metric
  `config.label`/`config.unit` seeding with omit-when-blank. Ran fresh:
  `npx jest --config jest.config.cjs --testPathPatterns=panelPayloads` → 17/17 passed. Full suite:
  `npm test` → 103 suites / 1113 tests passed.

- **AC3 — `TypeSelectStep.tsx` copy names all four chart types**: diff shows
  `"Visualize trends with line, bar, pie, or scatter"` (`TypeSelectStep.tsx:38`), with
  `PanelCreationModal.test.tsx` updated to assert the new string. Live-confirmed in the browser at
  both 1440×900 and 390×844 (screenshot `.playwright-mcp/skeptic-mobile-creation-modal.png`) — copy
  wraps cleanly, no truncation. Combobox in the "Name your panel" step live-lists all four options
  (Line, Bar, Pie, Scatter) — confirmed via accessibility snapshot.

- **Gates re-run myself (not trusted from evaluator's report)**:
  - `npm test` → 103 suites / 1113 tests passed.
  - `npm run lint` → 0 warnings.
  - `npm run format:check` → clean.
  - `npm run check:scala-quality` → clean (43 pre-existing soft-budget warnings, same set unrelated
    to this change).
  - `sbt "testOnly com.helio.api.ApiRoutesSpec"` → 177/177 passed.
  - `sbt test` (full backend) → 72 suites / 1389 tests passed.
  - `npm run check:openspec` → confirms the only reported issue is "complete but not archived" — the
    accepted deviation. No other hygiene issue reported.

- **D5 validation parity read in code**: `PanelServiceHelpers.scala` — `normalizeAppearancePayload`
  (shared, validates `chart.chartType` against the allow-list via `RequestValidation.validateChartType`),
  used by both `resolveCreateAppearance` (create) and `resolvePatch`'s appearance branch (single
  PATCH); `validateBatchChartTypes` folds over every batch item and is invoked in
  `PanelService.batchUpdate` before the transactional DBIO (`PanelService.scala:203-212`) — a bad
  item fails the whole batch pre-write. Confirmed by reading the new `ApiRoutesSpec.scala` tests
  (7 new cases: create+appearance persists, create default when absent, invalid chartType at create
  → 400, invalid at PATCH → 400, valid PATCH persists, batch invalid → 400 with an explicit
  "no partial write" assertion (re-reads the otherwise-valid first item's untouched appearance), batch
  valid persists) — all ran green in my fresh `ApiRoutesSpec` run above. `validateChartType`'s `None`
  branch returns `Right(None)` (`RequestValidation.scala:83-88`), so non-chart panels' absent
  `chart.chartType` in batch updates are correctly exempted, not spuriously rejected.

- **Root cause / systematic-debugging law**: `files-modified.md` records a probe (added the
  regression assertion first, ran it, got a real compile-time failure — `Property 'appearance' does
  not exist on type 'CreatePanelBody'` — proving the type had no channel for the selection) before
  the fix, then re-ran green after. This is a genuine probe-confirmed root cause, not an assumed one.

- **Scope / DESIGN.md**: only UI-visible diff is the one copy string; no new markup/tokens/components
  introduced. `git diff main...HEAD -- frontend/src/features/panels/ui/creationSteps/ChartCreatorFields.tsx`
  is empty — confirms the evaluator's claim that the pre-existing ~32px chart-type `<select>` trigger
  (sub-44px touch target) is untouched by this change and correctly out of scope.

- **Light/dark parity**: screenshot at 1440×900 in both dark (`.playwright-mcp/skeptic-desktop-view.png`)
  and light (`.playwright-mcp/skeptic-light-theme.png`) themes — the new scatter-chart render and
  surrounding chrome look consistent in both; no new visual surface was introduced by this change
  beyond the payload/validation logic and the one copy string, so no parity risk.

- **Console errors**: `browser_console_messages` across the full creation flow (open modal → select
  data type → name panel → select Scatter → create → mobile nav) shows 0 errors; the warnings present
  (`selectPipelineOutputDataTypes` memoization, ECharts zero-dimension-DOM) are pre-existing and
  unrelated to the touched files, matching the evaluator's characterization.

### Verdict: CONFIRM

All three ACs are traced to real code and independently reproduced live against the running app (not
just trusted from the evaluator's transcript). Gates re-run fresh and green across frontend and
backend. The D5 validation-parity extension is a reasonable, well-scoped response to the ticket's own
"repro-widening" instruction, not scope creep, and is itself tested with a genuine no-partial-write
assertion. No design-standard violations; the one copy-string UI change renders correctly at desktop
and 390×844 in both themes.

### Non-blocking notes
- `ApiRoutesSpec.scala` (4015 lines) and several other files are well over the 250-line soft budget —
  pre-existing, already flagged by the executor as a reasonable spinoff; no action needed here.
- The pre-existing chart-type `<select>` trigger in `ChartCreatorFields.tsx` remains under the 44px
  mobile touch-target guideline; confirmed genuinely pre-existing (zero diff) and out of this
  ticket's scope, but still worth a follow-up ticket.
