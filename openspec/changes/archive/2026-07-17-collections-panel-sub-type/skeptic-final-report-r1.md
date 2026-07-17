## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Gates re-run from scratch (not trusted from evaluator's report):**
- `npm run lint` → clean, zero warnings.
- `npm test` → 102 suites / 1092 tests passed.
- `npm run build` → succeeded (vite build, PWA precache generated).
- `sbt test` (backend, fresh embedded Postgres, Flyway migrated through V57) → 1382 tests, 0 failures.
- `npm run check:schemas` → "schemas in sync with JsonProtocols".
All four match the evaluator's claimed results; no discrepancy on re-run.

**The two design-gate-mandated fixes, read directly from the diff (not asserted):**
- `backend/src/main/scala/com/helio/domain/model.scala`: `case object Collection extends PanelType` +
  `"collection" => Right(Collection)` in `fromString` + `"collection"` in `asString` — present
  (`git diff main...HEAD -- .../model.scala`).
- `PanelServiceHelpers.buildNewPanel`: `case PanelConfigCodec.CollectionCreate(c) => CollectionPanel(...)` arm
  present; `dataTypeIdFromCreateConfig` also gained a `CollectionCreate` arm — present.
- `DashboardServiceValidation.validatePanelEntries` — confirmed by reading the file directly: it calls
  `PanelType.fromString(entry.`type`)` (shared code path), so the `model.scala` fix covers it transitively; no
  separate edit was needed and none is claimed in `files-modified.md` — consistent.
- `DashboardProposalService.DataPanelKinds` — `Set("metric", "chart", "table", "collection")`, confirmed by diff.
- `frontend/src/features/panels/hooks/usePanelData.ts` — explicit `panel.type === "collection" ? 50 : 10` ternary
  arm with a comment citing skeptic CR2, confirmed by diff (not the silent `else` bucket).

**Backend round-trip / absent-field tests, read in full (not just counted):**
- `PanelSpec.scala`: `CollectionPanelConfig.decode` tests fields ABSENT (not null) → defaults
  `baseType="metric"`, `layout="grid"`, `itemOptions=None`; malformed layout tolerated (never throws); full
  round-trip via `toJson`/`decode`; 8-kind exhaustiveness match includes `CollectionPanel`.
- `PanelRowMapperSpec.scala`: three new tests — full create→duplicate→read round-trip with baseType/layout/
  itemOptions set; NULL `collection_options` column → defaults; item options under a non-active base-type key
  survive the round-trip (D3 guard). This is the exact HEL-245/248 sibling-bug class the design called out, and
  it is genuinely covered, not just claimed.

**Live UI verification (servers on 5420/8327, fresh Playwright session, screenshots read and then deleted from
`.playwright-mcp/` — gitignored, never left at repo root):**
- Desktop, dark and light theme: existing collection panels (grid 5-item 2-col tile grid; list single-column
  with hairline divider + internal vertical scrollbar) render correctly in both themes, no washout, tags/spacing
  consistent with sibling panel cards.
- Opened `PanelDetailModal`'s Collection editor: base-type Select disabled with explanation text, DataType
  binding via the shared `DataTypePicker`, Value/Label/Unit fields using the HEL-243 `BoundOrLiteralField`
  pattern (bind/fixed toggle groups), Grid/List segmented control — matches design D7 exactly.
- Creation flow, end to end, live (not from the evaluator's report): Add panel → Collection card (icon present,
  correct description) → template step ("Metric Collection" + "Start blank") → DataType step (`Next` disabled
  until a DataType is picked, confirming `collection` is in `DATA_BOUND_TYPES`) → name step → Create. Verified
  the actual `POST /api/panels` payload via the panels API response: `{"baseType":"metric","dataTypeId":"<real
  id>","fieldMapping":{},"layout":"grid"}` — creation-time fields carried explicitly, not a `typeConfig`
  passthrough (HEL-305 lesson honored).
- Duplication: read the live panels API response for the original vs. "(copy)" panel — `fieldMapping`,
  `itemOptions`, `dataTypeId`, `baseType` are identical between the two (the copy's `layout` differs only
  because the original was edited to `list` *after* the duplicate was made, per each panel's own
  `lastUpdated` timestamp — not a duplication bug).
- Empty/unbound state, verified as a real live state, not just the wizard preview: cleared a bound collection's
  DataType via "Clear selected data type" → Save → the panel body correctly renders "Bind a data type to
  populate this collection" (the true `CollectionRenderer` unbound branch, confirmed working end-to-end).
- Noted and investigated one apparent discrepancy: a collection panel that is bound (has a real `dataTypeId`)
  but has no field mapping yet renders 5 tiles each showing `"--" / "No data"`, rather than the unbound
  placeholder. I checked whether this is a defect by reproducing the identical state on a plain **Metric**
  panel (pre-existing kind, not touched by this change): it renders the exact same `"--" / "No data"` preview
  for the same reason (bound, no field mapping). This is pre-existing, consistent sibling behavior, not a
  collection-specific bug — not a REFUTE.
- Mobile (390×844, read-only per HEL-304), both existing layouts: grid shows a clean 2-column tile layout,
  list shows a single-column divided list, both intrinsic-height (no internal scroll, matching the explicit
  `mobilePanelHeights.ts` `case "collection"` arm, confirmed by diff with its D5 comment). Programmatic check:
  `document.documentElement.scrollWidth === clientWidth === 390` for both grid and list layouts — no horizontal
  overflow.
- Mobile touch targets, measured via `getBoundingClientRect()` in the live DOM (not just the CSS-lock test):
  the Grid/List segmented buttons measure `165.5×44`px; the Label/Unit mode-toggle buttons measure `79.75×44`px.
  All meet the ≥44px requirement. Confirmed the CSS-lock test (`PanelDetailModal.css.test.ts`) exists and
  targets `.panel-detail-modal__segmented-btn` inside the `max-width: 768px` block — not a no-op assertion.
- No console errors introduced by this change. Two pre-existing warnings ("Selector
  `selectPipelineOutputDataTypes` returned a different result...") originate from `dataTypesSlice.ts`, a file
  untouched by this diff (`git diff --stat` confirms zero changes to `features/dataTypes/`) — not a regression.
  Two stale 403s on `/api/dashboards/import` seen in the full console history are from an earlier session in
  this shared browser context (also called out independently in the evaluator's own report) — unrelated to
  collection panels.
- DESIGN.md compliance: `CollectionRenderer.css` and the `PanelDetailModal.css` additions use only
  `--space-*`/`--app-*`/`--text-*` tokens (confirmed by reading both files in full); canonical breakpoint
  (`max-width: 768px`) reused, not a new one; shared components reused throughout (`Select`, `DataTypePicker`,
  `BoundOrLiteralField`, `MetricRenderer`) — no hand-rolled equivalents found.
- Schema extensibility claim verified structurally: `schemas/panel.schema.json`'s `CollectionConfig` has
  `baseType` as a plain string enum (`["metric"]` today) and `itemOptions` keyed per base type via
  `$defs.CollectionItemOptions` — widening to a second base type is an enum-widen + new `$defs` key, no new
  JSONB column, matching the ticket's "no schema changes for future base types" requirement.

### Verdict: CONFIRM

All acceptance criteria in `ticket.md`'s Definition of Done trace to real, working code and passing tests. Both
skeptic design-gate findings (the second `PanelType` enum in `model.scala`/`PanelServiceHelpers` and the
`usePanelData.ts` page-size arm) are genuinely fixed, not just mentioned in prose. All four gates (lint, test,
build, sbt test) reproduce green on a cold re-run. Mobile legibility, ≥44px touch targets, and no-horizontal-
overflow were independently measured (not just visually eyeballed) at 390×844 for both grid and list layouts.
Light/dark theme parity holds. The HEL-245/248 sibling-bug class (missed `PanelRowMapper` write direction) has
an explicit round-trip regression test that would catch it. Duplication was verified via the live API response,
not just a screenshot comparison.

### Non-blocking notes

- The evaluator's Phase 3 report describes the freshly-created collection panel as rendering the "unbound
  placeholder" immediately after the creation wizard completes. Ground truth: the wizard's DataType step
  requires a real selection before `Next` enables, so the newly created panel is actually bound (has a real
  `dataTypeId`) and — with no field mapping chosen yet — renders 5 tiles of `"--" / "No data"`, not the unbound
  placeholder text. The "Bind a data type…" text the evaluator likely saw is from the wizard's static preview
  mock (`PanelCreationPreview.tsx`), which always shows the kind's default empty config regardless of what was
  picked in the DataType step — this is pre-existing behavior shared by every data-bound kind (metric/chart/
  table), not something introduced by this change, so it is not a code defect. Recommend the evaluator tighten
  this wording in future reports (verify the live post-creation panel state, not just the wizard preview) but
  it does not change the verdict here since the actual unbound state was independently verified to work
  correctly on a real panel.
- `CollectionEditor.tsx` is 285 lines, over the ~250-line informational soft budget (per CONTRIBUTING.md,
  non-blocking).
- Minor scalafmt alignment drift on sibling match arms in `PanelConfigCodec.scala` and
  `DashboardSnapshotRepository.scala` (cosmetic column-alignment only) — does not affect `check:scala-quality`.
- No `ApiRoutesSpec` HTTP-level test for `POST /api/dashboards/import` with a `type: "collection"` panel
  (covered at the unit level via `PanelRowMapperSpec` and structurally via diff review of the
  `DashboardSnapshotRepository.scala` arm). Reasonable to defer to a follow-up.
