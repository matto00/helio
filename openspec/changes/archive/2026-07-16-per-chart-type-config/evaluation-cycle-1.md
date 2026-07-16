## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none blocking.

- All three ACs addressed: type swap works (verified live in Playwright — Line/Bar/Pie/Scatter
  Display sections swap correctly on the Appearance chart-type radio); every control maps to a
  real ECharts construct (D4 mapping verified against `chartTypeOptions.ts` + `ChartPanel.tsx`
  scatter branch — no fake controls); existing panels keep working (nullable `chart_options`
  column, `decode`/`Patch` treat absence as current behavior, confirmed via
  `PanelRowMapperSpec` "NULL column → None" test).
- Task list (24/24) matches implementation; `tasks.md` checkboxes correspond to real, verified code
  (not rubber-stamped — spot-checked 1.1–1.6, 2.1–2.9, 3.1–3.9 against the diff).
- Scope: `MetricBindingFields.tsx` extraction (D5 split) is behavior-preserving — diff shows a pure
  JSX move, no logic change. `fieldOptions.ts`'s `aggFieldOptions` relocation is also a pure move.
  No scope creep beyond what proposal.md/design.md declare.
- Schema/contract: `schemas/panel.schema.json` updated in the same change; `npm run
  check:schemas` passes (drift check clean).
- Planning artifacts (design.md D1–D6) match the final implementation exactly, including the two
  "Planner Notes (self-approved)" deviations (scatter fields live in `chartOptions` not
  `fieldMapping`; semantic option names) — both are followed as documented.

Two judgment calls the executor flagged, evaluated:
1. **Validation lives in domain `ChartOptions.parse`, not `RequestValidation`.** The ticket's stated
   persistence convention explicitly lists `RequestValidation` as a touchpoint, and the *actual*
   HEL-255 precedent (`TablePanelConfig.Patch.decode`) calls
   `RequestValidation.validateTableDensity` from inside the domain decode — i.e., the established
   pattern is "domain calls into a `RequestValidation` allow-list constant," not "domain owns its
   own allow-list." This diff instead defines `ValidOrientations`/`ValidStackings`/`BarGapRange`/
   `DonutHoleRange` entirely inside `ChartOptions` (`ChartPanel.scala`), so `RequestValidation.scala`
   is untouched. Behaviorally this is correct (400s fire correctly, verified by `PanelSpec`/
   `ApiRoutesSpec` invalid-enum tests), but it diverges from the single-source-of-truth convention
   the rest of the file already establishes (`ValidTableDensityValues`, `ValidChartTypeValues`,
   `ValidDividerOrientationValues`, `ValidImageFitValues` all live in `RequestValidation.scala`).
   Non-blocking — flagged for consistency, not correctness.
2. **`showPoints` normalizes to store only non-default `false`.** Correct and deliberately
   documented (`normalizeChartOptions` in `useChartDisplayState.ts`) — ECharts defaults to markers
   on, so persisting `true` would be redundant; only the "off" override needs storage. Sound.

---

### Phase 2: Code Review — PASS
Issues: none blocking; one consistency suggestion (see Phase 1 item 1) and one file-size nit below.

- **CONTRIBUTING.md [mechanical]**: `npm run check:scala-quality` clean (no inline FQNs). All new
  imports in `ChartPanel.scala`, `ChartDisplayFields.tsx`, `chartTypeOptions.ts` are top-of-file.
  File-size soft budgets: `ChartPanel.scala` now 314 lines (soft-budget warning only, informational
  per CONTRIBUTING — not a hard gate). `BindingEditor.tsx` is **401 lines** after the D5 split
  (`wc -l`) — one line over the 400-line threshold the ticket explicitly named as the target
  ("BindingEditor.tsx sits at the 400-line CONTRIBUTING.md split threshold; if chart-type config
  pushes it past, split it rather than growing it"). The split *did* happen (extracted
  `MetricBindingFields.tsx` + moved `aggFieldOptions` to `fieldOptions.ts`) and landed 1 line over
  the very number cited — a trivial, easily-fixed miss (frontend files aren't covered by the
  automated `check:scala-quality` size gate, so nothing failed CI, but it's the literal criterion
  the ticket asked to satisfy). Non-blocking suggestion, not a fail.
- **DESIGN.md [mechanical]**: `ChartDisplayFields.tsx`/`PanelDetailModal.css` reuse existing BEM
  classes (`panel-detail-modal__data-section`, `__mapping-row`, `__slider`) and the shared `Select`
  component — no hand-rolled dropdowns. All spacing/type/color values in the new CSS use
  `--space-*`/`--text-*`/`--app-*` tokens (grepped the diff; zero literal px/hex except the
  precedented `44px` touch-target minimum, which mirrors the pre-existing HEL-245/255 media-query
  pattern verbatim). Speaks the Epic A config language as directed — scatter's field selects use
  the `aggFieldOptions`-style "— None —" pattern, matching `BoundOrLiteralField`/`fieldOptions`
  idioms.
- **DRY**: `aggFieldOptions` moved to shared `fieldOptions.ts` rather than duplicated. `ChartPanel.tsx`
  delegates all per-type option logic to `chartTypeOptions.ts` (`applyChartTypeOptions`,
  `makeScatterSymbolSize`) rather than inlining — good separation, keeps `ChartPanel.tsx` from
  growing.
- **Readable/Modular**: `useChartDisplayState`/`ChartDisplayFields` mirror the `useTableDisplayState`/
  `TableDisplayFields` precedent closely, as designed. `normalizeChartOptions` is well-commented on
  *why* each default is dropped.
- **Type safety**: no `any`; `ChartTypeOptionsMap`/per-type interfaces are fully typed on both
  sides of the wire; Scala side uses typed case classes, not raw `JsObject` (an explicit, disclosed
  improvement over the `aggregation: Option[JsObject]` precedent — see design D2).
- **Security**: enum/range validation on every mutable field (`orientation`, `stacking`,
  `barGapPct` 0–100, `donutHolePct` 0–90); invalid input → 400, verified by both `PanelSpec` and
  `ApiRoutesSpec`.
- **Error handling**: `ChartOptions.parse` cleanly distinguishes strict (create/PATCH, throws
  `deserializationError` → 400) vs. lenient (stored-row read, drops to `None`) — matches the
  established `TablePanel`/HEL-255 asymmetry.
- **Tests**: exercised the exact pitfall the ticket named — `PanelRowMapperSpec` "round-trip a Chart
  panel with per-type chartOptions set" / "...absent (NULL column → None)" cover both mapper arms
  explicitly with a comment citing the HEL-245/255 bug class. `PanelSpec` tests fields ABSENT
  (spray-json omission) by name. `PanelDetailModal.chartDisplay.test.tsx`'s last test is the
  acceptance-criterion test verbatim: switch line→bar, edit only bar, and assert
  `chartOptions === { line: { smooth: true }, bar: { stacking: "stacked" } }` plus binding/refresh
  preserved — this is a real regression-catching test, not a tautology.
- **No dead code**: no leftover TODO/FIXME in the diff (grepped).
- **No over-engineering**: `ChartOptions` case-class hierarchy is proportionate to four real chart
  types; no speculative fifth-type scaffolding.
- Fresh gates re-run independently (not trusting executor's paste):
  - `npm run lint` — clean (0 warnings)
  - `npm run format:check` — clean
  - `npm test` (frontend) — **99 suites / 1072 tests passed**
  - `npm run build` — succeeds (pre-existing chunk-size warning only, unrelated)
  - `npm run check:scala-quality` — clean (43 pre-existing soft warnings, none new besides
    `ChartPanel.scala`'s expected size warning)
  - `npm run check:schemas` — in sync
  - `cd backend && sbt test` — **1362 tests passed, 0 failed**

---

### Phase 3: UI Review — PASS
Issues: none blocking the AC; two significant findings below (both non-blocking / out of scope —
see rationale).

Servers started via `scripts/concertino/start-servers.sh` / `assert-phase.sh` — both PASS.

**Desktop verification (1440/1100 + default width), logged in as matt@helio.dev:**
- Created a live chart panel bound to a real `Profit` DataType (date/profit fields), exercised all
  four chart types end-to-end through the real UI (not just unit tests):
  - **Bar**: set orientation=Horizontal, stacking=Stacked, group spacing=20% → saved → reloaded →
    chart correctly renders as a **horizontal stacked bar** (axis roles swapped per D4).
  - **Pie**: switched from Bar to Pie, set donut hole=40%, percentage labels on → saved → reloaded
    → chart renders as a **donut with `{b}: {d}%` labels** legend intact.
  - **Switched back to Bar**: orientation/stacking/group-spacing were **exactly restored** — the
    core "switching type preserves other types' options" AC verified live via a real save→reload
    round trip, confirmed via direct API fetch (`config.chartOptions` held both `bar` and `pie`
    entries simultaneously, keyed correctly).
  - **Scatter**: switched to Scatter, Display section correctly showed Point-size/Color-by field
    selects (hidden until bound, per spec); saved; scatter renders (coordinate rendering confirmed;
    size/color grouping logic is unit-tested in `ChartPanel.test.tsx`, not independently
    re-exercised with numeric fields here due to test-data limits — acceptable given full backend/
    frontend suites pass).
- Creation-modal: all four chart types (including new Scatter) are selectable in
  `ChartCreatorFields`, confirmed via snapshot.
- No console errors during any of the above (checked after each navigation).
- Breakpoint sweep 1440 / 1100 / 768 — Display section and donut/bar renders reflow cleanly, no
  layout breakage, no horizontal overflow.

**Mobile verification (~390×844, mobile shell active):**
- All tested chart types (bar/pie/scatter) render legibly in `MobilePanelStack` — axes, legend, and
  donut labels visible and not clipped at 390px and at 768px.
- New Display controls (toggle rows, range sliders, scatter field `Select`s) measured via DOM
  `getBoundingClientRect()` at 390px width: **all ≥44px height** (toggle rows, range inputs, and
  Select triggers all measured exactly 44px), matching the `PanelDetailModal.css.test.ts` CSS-lock
  additions.
- No horizontal overflow at 390px (`document.documentElement.scrollWidth === clientWidth === 390`).
- No console errors specific to this session's interactions (some cross-origin/parallel-session
  noise on port 5428 appeared in the full console log — unrelated to this worktree's port
  5421/8328, discounted).

**Finding 1 (non-blocking, pre-existing, out of scope): create-time chart-type selector has no
effect.** Selecting Bar/Pie/Scatter in the *creation* modal's "Chart type" combobox
(`ChartCreatorFields`) never reaches the created panel — `buildCreatePanelBody`/`seedCreateConfig`
in `panelPayloads.ts` (unmodified by this diff, byte-identical to `main`) only seeds `dataTypeId`
for the "chart" case and never reads `typeConfig.chartType`. Every panel is created with the
default appearance chart type ("line") regardless of the creation-modal selection; the user must
change it afterward in the edit pane (which works correctly). Verified by code trace and by
creating a panel with "Bar" selected, which rendered as "Line" until manually switched in Edit.
This bug **pre-dates HEL-248** (identical on `main`) and is not something this diff introduced —
HEL-248 only added the fourth ("Scatter") option to an already-non-functional selector without
noticing. Recommend a spinoff ticket; does not block this change since the AC is about the edit-pane
swap/persistence behavior, which works.

**Finding 2 (non-blocking, pre-existing, out of scope, but significant): panel *appearance* edits
made while viewport is <768px are not persisted until the viewport returns to ≥768px.** Root
cause traced to `PanelGrid.tsx`/`usePanelGridSave.ts` (both untouched by this diff): panel
appearance changes (title, background, color, transparency, and — relevant here — the chart-type
selector, since `chartType` lives in `appearance.chart`) are staged via `accumulatePanelUpdate`
into Redux `pendingPanelUpdates` and flushed by a 30-second interval owned by `usePanelGridSave`,
which per the code's own comment is **only mounted inside `DesktopPanelGrid`** — "there is no code
path capable of persisting a layout write from the phone stack" (the same hook also owns the panel-
appearance flush, not just layout). Reproduced conclusively: edited chart type + title at 390px,
"Save panel settings" closed the modal with no error, but a direct API fetch immediately after
showed the *old* persisted values; the edit only actually reached the backend once the browser was
resized back to desktop width (the 30s interval then flushed the still-pending Redux state). Panel
**config** edits (this ticket's `chartOptions`, via the `updatePanelBinding` thunk) are unaffected —
they PATCH immediately regardless of viewport width, since they don't route through
`pendingPanelUpdates`. This is a genuine, reproducible, and user-impacting gap in the HEL-300/301/302
mobile-shell architecture (silently drops panel-appearance edits made from the phone "Edit" sheet),
but it is **not introduced by this diff** (confirmed identical code path pre-dates HEL-248) and
affects every panel type's appearance fields, not chart-Display config specifically. Recommend an
urgent spinoff ticket given it silently loses user edits with no error surfaced. Does not block
HEL-248: the ticket's own mobile checklist (render legibility, ≥44px targets, no overflow) all pass,
and this diff's own config-level persistence (the actual AC) is unaffected by the gap.

---

### Overall: PASS

### Non-blocking Suggestions
1. Move `ChartOptions.ValidOrientations`/`ValidStackings`/`BarGapRange`/`DonutHoleRange` into
   `RequestValidation.scala` (as `validateChartOrientation`/`validateChartStacking`/clamp helpers)
   and have `ChartPanel.scala`'s `enumField`/`clampedIntField` call into them, matching the
   `TablePanelConfig.Patch.decode` → `RequestValidation.validateTableDensity` precedent this file
   otherwise follows exactly. Purely a consistency nit; behavior is already correct.
2. `BindingEditor.tsx` is 401 lines (1 over the 400-line threshold the ticket explicitly named as
   the split trigger). Trim a handful of lines (e.g., tighten the chart-Display JSX block or merge
   adjacent comment lines) to land under 400, honoring the letter of the directive.
3. Recommend filing HEL-3xx spinoff tickets for the two Phase-3 findings above (create-time
   chart-type selector no-op; mobile-viewport appearance-edit persistence gap) — both are real,
   reproducible, and worth tracking, but are pre-existing and out of this ticket's scope.
4. `TypeSelectStep.tsx`'s panel-type description text ("Visualize trends with line, bar, or pie")
   is now stale — Scatter is a fully supported fourth type but isn't mentioned. Not touched by this
   diff; trivial follow-up.
