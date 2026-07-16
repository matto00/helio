## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Planning artifacts read:** `ticket.md` (incl. the RESOLVED scope escalation and binding session
emphases), `proposal.md`, `design.md` (D1–D7), both spec deltas, `tasks.md`, `files-modified.md`,
`evaluation-report-cycle-2.md` (treated as claims, independently re-checked below).

**Gates re-run fresh, myself, in this worktree:**
- `cd backend && sbt test` → `1339 tests, 0 failed` (fresh run, not reused from evaluator). Flyway
  log shows migration `55 - panel table display config` applies cleanly on top of 54 prior
  migrations.
- `cd frontend && npm test` → `96 suites / 1040 tests passed`.
- `cd frontend && npm run lint` → zero warnings.
- `cd frontend && npm run format:check` → clean.
- `git diff main...HEAD --stat` → 39 files, no `Bin` marker anywhere (CR#2 from cycle 1, the NUL-byte
  binary-file regression, confirmed fixed — `useTableDisplayState.ts` is plain text).

**Backend code read directly (not just tests):**
- `TablePanel.scala` — `density`/`columnOrder` added to `TablePanelConfig` and `Patch`; `decode` is
  lenient (invalid/wrong-typed density → absent); `Patch.decode` validates density via
  `RequestValidation.validateTableDensity` and calls `deserializationError` on an invalid value (→
  400); `applyPatch` folds both fields with the same `None`/`Some(None)`/`Some(Some(_))` triage as
  `columnWidths`. Matches design D3 exactly.
- `PanelRepository.scala` — `tableDensity`/`columnOrder` added to `PanelRow`, the Slick columns, and
  **both** `configColumnsOf` and `configColumnValuesOf` (12→14 elements each). The `*` projection was
  converted to a Slick `HList` because a 23-element tuple exceeds Scala's 22-tuple ceiling — a
  deviation from the literal design text, called out honestly in `files-modified.md`, and it is
  behavior-preserving (verified via the passing repository/endpoint persistence test below).
- `PanelRowMapper.scala` — table arm now writes/reads `tableDensity`/`columnOrder` in both
  directions (`domainToRow` / `tableConfig`), with dedicated JSON array encode/decode helpers,
  addressing the HEL-245 sibling-bug risk named in the ticket.
- `V55__panel_table_display_config.sql` — two nullable columns, no backfill, well-commented,
  consistent with the V53 "dedicated column per display concern" precedent.
- `schemas/panel.schema.json` — `TableConfig` gains `density` (enum) + `columnOrder` (string array),
  `additionalProperties: false` retained.
- Backend test diffs read in full (`PanelSpec.scala`, `PanelRowMapperSpec.scala`,
  `ApiRoutesSpec.scala`): cover absent-vs-null-vs-value for both fields, invalid density on both the
  strict Patch path (400) and the lenient decode path (silently absent), and — critically — the
  `ApiRoutesSpec` persistence tests PATCH then re-fetch through a **real repository read**
  (`GET /api/dashboards/:id/panels`, not the PATCH response), which is exactly the check that would
  have caught a missed `configColumnsOf`/`configColumnValuesOf` extension.

**Frontend code read directly:**
- `TableRenderer.tsx` — `orderedColumns()` implements D2 precisely (absent/empty → natural order;
  non-empty → listed keys in order, intersected with keys present in data, stale keys silently
  skipped); `widthsSignature()` re-seeds local width state on content change (not just panel-id
  change), fixing the D6 "reset visibility without reload" requirement; resize now dispatches the
  `updatePanelColumnWidths` thunk (not a bare service call) so the Redux-stored panel stays in sync.
- `useTableDisplayState.ts` — dirty tracking, patch-shape (absent/null/value), density defaulting,
  columnOrder building (visible-then-hidden ordering so every DataType field is always listed), and
  reset-widths pending state. `patch.columnOrder` uses `null` (not omitted) when reordering makes the
  order equal to natural order — sensible "explicit default" semantics matching design's
  Risks/Trade-offs note.
- `TableDisplayFields.tsx` — density `Select` (shared component, Epic A pattern), column
  visibility+reorder rows with `aria-label`s on the move buttons, Reset button gated on
  `hasStoredWidths`.
- `BindingEditor.tsx` — wires the hook/component into the existing save/cancel/dirty contract;
  `tableDisplay.patch` folds into the single `updatePanelBinding` PATCH.
- `panelSlots.ts` — vestigial `table: [{key: "columns", ...}]` slot correctly removed to `[]`;
  confirmed via `BindingEditor.tsx:292` (`slots.length > 0` guard) that this doesn't leave a
  dangling empty "Field mapping" section — verified live in the browser (no such section renders).
- `panelPayloads.ts` / `panelService.ts` / `panelThunks.ts` / `panelsSlice.ts` — `TableDisplayPatch`
  threaded end-to-end; CR#1 fix (`updatePanelColumnWidths` thunk + `.fulfilled` reducer) present and
  wired from `TableRenderer`'s resize handler.
- `PanelDetailModal.css` — new styles use tokens exclusively (`--space-*`, `--app-*`,
  `--control-sm/md`, `--text-*`, `--font-mono`) — no hardcoded values found. Mobile media block
  extends the existing HEL-245 `@media (max-width: 768px)` rule (not a new one) with `min-height:
  44px` / `min-width: 44px` on `.panel-detail-modal__column-row`, `__column-visibility`,
  `__column-move-btn`, `__reset-widths-btn`. `PanelDetailModal.css.test.ts` locks these selectors.

**Live, adversarial browser verification (Playwright, ports 5428/8335, logged in as
matt@helio.dev):**
Servers were already running; `scripts/concertino/assert-phase.sh servers ... 5428 8335` → `PASS`.
I created a **fresh** Table panel ("Skeptic Table Verify Panel", bound to `HEL254WideType`) in the
existing `HEL-255 Table Config Eval` dashboard rather than trusting leftover evaluator state, and
drove every load-bearing scenario myself:
- **Pre-existing/default panel** renders normal density + all columns natural order on creation
  (screenshot: modal open, uniform row height, `col_0..col_10...` natural order).
- **Density change** (Normal→Condensed) + Save → grid re-rendered condensed **without reload**
  (visible in the dashboard card immediately after Save).
- **Column reorder + hide** (moved `col_6` above `col_27`, unchecked `col_16`) + Save → PATCH body
  captured via an `XMLHttpRequest.send` monkey-patch:
  `columnOrder: ["col_27","col_6","col_3",...,"col_23"]` (29 keys, `col_16` correctly excluded).
  Re-opening Edit afterward showed the Columns list with `col_16` unchecked and appended at the end
  (matches design D5's "always list every current field" rule) — and the dashboard card rendered
  the new column order live.
- **Full reload persistence**: re-fetched `GET /api/dashboards/:id/panels` after a fresh
  `page.goto()` (not SPA nav) — `density: "condensed"`, full `columnOrder` (30 entries incl.
  `col_16` at the end from a later toggle), `columnWidths` all present exactly as last saved.
- **Cancel reverts unsaved edits**: changed density to Spacious in the edit pane (no save) → clicked
  Cancel → "Unsaved changes, discard?" prompt appeared (dirty-tracking correctly triggered) →
  Discard → re-opened Edit → density read back "Condensed" (the Spacious change did not leak).
- **Reset column widths, same session, no reload (CR#1 regression guard)**: focused the grid's
  keyboard resize handle (`role="separator"`, `aria-label="Resize column col_27"`), pressed
  ArrowRight×4 → waited past the debounce → confirmed via `GET .../panels` that
  `columnWidths: {"col_27": 200}` persisted server-side → **without reloading**, opened Edit →
  Reset button was **enabled** (`disabled: false`) — confirms the CR#1 fix (`updatePanelColumnWidths`
  thunk syncing Redux) actually works, not just claimed. Clicked Reset → button flipped to "Column
  widths will reset on save" (disabled/pending) → Save → re-fetched config: `columnWidths: {}` —
  cleared — and the dashboard card visually widened back to default-derived widths, no reload.
- **Unbound hides Columns control**: in the edit pane, clicked the DataType "×" (clear) button →
  the Cell density control remained but the entire Columns section (and its "Columns" label)
  disappeared from the DOM (`querySelector` returned none) — matches the spec precisely (only
  Columns is gated on binding, not density). Cancelled/discarded this change afterward so the test
  panel stays bound for reuse.
- **Display-only save doesn't alter dataTypeId/fieldMapping (wire-level check)**: captured the exact
  PATCH body for a density/columnOrder-only edit —
  `{"config":{"dataTypeId":"705f8ae7-...","fieldMapping":null,"columnOrder":[...]}}`. `dataTypeId`
  is resent unchanged (identical value, not "altered"); `fieldMapping` is `null` but the panel's
  stored `fieldMapping` was already `{}` (table panels have had no field-mapping UI since the
  vestigial slot removal), so this is a functional no-op — confirmed by re-fetching the panel and
  finding `fieldMapping: {}` before and after. This mirrors the pre-existing HEL-243/244 "resend the
  whole binding on every save" convention (not something HEL-255 introduced) and satisfies the
  spec's intent (end state unaltered), even though the mechanism (resend-unchanged vs. omit-key)
  differs from what the backend unit test simulates.
- **Mobile (390×844), first-class per the ticket's binding emphasis**:
  - Mobile shell activated (bottom nav, `MobilePanelStack`) — the Table panel rendered with its
    persisted config; `document.documentElement.scrollWidth === innerWidth === 390` (no horizontal
    overflow).
  - Opened the edit pane in the mobile stack and measured real `getBoundingClientRect()` heights
    (not just reading CSS source): density trigger 44px, column row 54px, visibility label 44px,
    move-up/down buttons 44×44px each, Reset-widths button 44px. All meet the ≥44px requirement by
    live measurement, not just the CSS-lock test's static assertion.
  - 0 console errors throughout the whole session (`browser_console_messages` level=error → 0).
- **Breakpoints 1440 / 1100 / 768**: screenshotted all three; grid layout scales cleanly, no
  overflow or broken cards. (768px triggers the mobile shell per the existing `max-width: 768px`
  breakpoint convention — expected, not a regression.)
- **Light/dark parity**: toggled to light theme mid-edit-pane — modal stays opaque, checkboxes use
  the accent token (orange), borders/text follow the neutral ramp, Reset button's disabled state
  reads correctly, no dark-only hardcoded colors bleeding through.

### Verdict: CONFIRM

### Non-blocking notes
- `BindingEditor.tsx` is ~434 lines post-diff, over CONTRIBUTING.md's informational split-suggestion
  threshold — already flagged in cycle 1/2 evaluator reports as non-blocking; I agree it's not
  blocking (the file is well-organized by section, and the table-display logic itself is properly
  extracted into `useTableDisplayState.ts`/`TableDisplayFields.tsx`).
- The Slick `HList` projection deviation from the design's literal "extend the tuple" text is a
  reasonable, well-documented, behavior-preserving adaptation forced by Scala's 22-tuple ceiling —
  correctly called out in `files-modified.md` rather than silently diverging.
