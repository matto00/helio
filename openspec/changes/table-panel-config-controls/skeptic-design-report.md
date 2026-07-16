## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**Round-1 Change Request 1 (invalid-density contradiction) — genuinely resolved.**
- `design.md` D3 now states explicitly: PATCH path validates via a new
  `RequestValidation.validateTableDensity` allow-list checked in `Patch.decode`, rejecting unknown
  values with `deserializationError` → 400 ("`imageFit`/`orientation` precedent exactly"); the
  lenient create/read `decode` path treats a wrong-typed or unknown value as absent. These are two
  named, non-overlapping code paths — the prior single-sentence contradiction is gone.
- Verified against ground truth: `RequestValidation.scala` has `validateImageFit` (line 65),
  `validateDividerOrientation` (74), `validateChartType` (83) but no `validateTableDensity` yet
  (correctly a to-do, not yet implemented at design time). `ImagePanel.scala` confirms the exact
  precedent shape: `Patch.decode`'s `imageFit` case calls `RequestValidation.validateImageFit(Some(s))`
  and `deserializationError` on `Left`, while `ImagePanelConfig.decode` (the lenient path) simply
  takes the string or falls back to `DefaultFit` with zero validation — i.e., 400 only on `Patch`,
  never on lenient `decode`. This is exactly what D3 now specifies for `density`.
- `specs/table-panel-display-config/spec.md` was correspondingly split into two distinct, compatible
  scenarios: "Invalid density on PATCH is rejected" (400) and "Invalid density on the lenient
  read/create path is treated as absent" — no more single contradictory sentence.
- `tasks.md` 1.3 adds the missing validator line: `add RequestValidation.validateTableDensity
  allow-list checked in Patch.decode (invalid → deserializationError → 400, imageFit precedent)`.
  Task 4.1 adds both test cases (`invalid density on PATCH → 400`, `invalid density on lenient
  decode → absent`). **Resolved.**

**Round-1 Change Request 2 (`configColumnsOf`/`configColumnValuesOf` tuple + real persistence test) — genuinely resolved.**
- Read `PanelRepository.scala` lines 235–321 directly: `configColumnsOf`/`configColumnValuesOf` is a
  12-element tuple pair (confirmed by counting: `typeId, fieldMapping, content, imageUrl, imageFit,
  dividerOrientation, dividerWeight, dividerColor, aggregation, metricLabel, metricUnit,
  columnWidths`), documented in-repo as the HEL-296 single source of truth that both
  `PanelRepository.replace` (line 205-206) and the batch-update config-patch branch write through.
  `design.md` D3 now explicitly names this tuple pair and states "12 → 14 elements"; `tasks.md`
  1.4 explicitly instructs extending it. This matches the actual current tuple size exactly — no
  drift between the design's claim and the real code.
- `tasks.md` 4.3 and `specs/table-panel-display-config/spec.md`'s new "New config columns persist
  through the shared config-column write path" requirement now require a repository/endpoint-level
  round-trip test (PATCH → re-read through the repository), which is the layer below
  `PanelRowMapper` where the prior design's test would have missed the tuple-pair omission.
  **Resolved.**

**Independent re-verification beyond the prior findings (design soundness, precedent consistency, DoD coverage, scope).**
- `TablePanel.scala` current shape (`TablePanelConfig(dataTypeId, fieldMapping, columnWidths)`,
  `decode`/`Patch`/`Patch.decode` with `None`/`JsNull`/typed triage for `columnWidths`) matches the
  HEL-253 pattern D3 says to mirror — confirmed directly, not just asserted.
- `schemas/panel.schema.json` `TableConfig` def (lines 75–87) has exactly `dataTypeId`,
  `fieldMapping`, `columnWidths`, `additionalProperties: false` — matches D4's extension target and
  the "keep `additionalProperties: false`" instruction in task 1.5.
- `db/migration/`: latest is `V54__image_uploads.sql`; `V55` is correctly the next free number, and
  `V53__panel_column_widths.sql`'s stated precedent ("its own nullable JSONB column... display
  concern layered on top of the binding") is the real, cited rationale D1 relies on.
- `TableRenderer.tsx`: confirmed the pagination-rows branch (lines 74–107) passes no `columns` prop
  today (relies on `DataGrid`'s internal `deriveColumns`), while the `rawRows` branch (109–124)
  builds an explicit `ColumnDef[]` from `headers`. Task 2.2's requirement to build `columns` "for
  both the pagination and rawRows paths" correctly targets a real, asymmetric gap — not invented.
  `DataGrid.tsx` confirms `density?: DataGridDensity` and `columns?: ColumnDef[]` already exist as
  props (lines 50, 64), so D6/task 2.2 is additive wiring, not a `DataGrid` change (consistent with
  the stated Non-Goal).
- `panelSlots.ts` line 18 (`table: [{ key: "columns", label: "Columns" }]`) and `BindingEditor.tsx`
  (`slots.length > 0` gate at line 278, `PANEL_SLOTS` import at line 9) confirm removing the
  vestigial slot is safe and real, per D5/task 3.4.
- `panelService.ts` confirms the one-thunk-per-PATCH-concern precedent (`updatePanelBinding`,
  `updatePanelTextBinding`, `updatePanelColumnWidths`) that D5's "sibling thunk, executor's call"
  leaves open as a reasonable, precedented choice.
- `PanelDetailModal.css` line 434's `@media (max-width: 768px)` block and the existing
  `PanelDetailModal.css.test.ts` CSS-lock test are real and directly extensible per D7/tasks
  3.6/4.6 — not a hypothetical pattern.
- Ticket DoD trace: "controls redesigned" → D5/spec `table-panel-config-editor`; "map cleanly to
  DataGrid props" → D6/spec `table-panel-display-config`'s density+columnOrder-render requirements;
  "Epic A config language" → D5's explicit `panel-detail-modal__*` + shared `Select` reuse; "migrate
  cleanly with defaults" → D1/D2 absent-means-default + explicit migration scenario + task 4.3's
  "migration leaves existing rows NULL/defaults" line. All four DoD bullets trace to concrete
  design decisions and test tasks, not just prose.
- Scope check: `proposal.md` Non-goals and `design.md` Non-Goals both correctly exclude other panel
  kinds, a generalized display-config abstraction, `DataGrid` changes, and drag-and-drop — matching
  the escalation's "Option 1: minimal storage extension" resolution exactly. No file outside
  `TablePanelConfig`'s surface (backend `TablePanel.scala`, `PanelRowMapper`, one migration,
  `panel.schema.json`; frontend `panel.ts`, `TableRenderer.tsx`, `BindingEditor.tsx` + one new
  editor component, `panelSlots.ts`, PATCH plumbing, `PanelDetailModal.css`) is touched by the plan.
- No new internal contradictions found between `proposal.md`/`design.md`/`tasks.md`/specs on a full
  side-by-side re-read; no placeholders, `TODO`s, or deferred decisions remain that would block an
  implementer.

### Verdict: CONFIRM

### Non-blocking notes

- (Carried from round 1, still applicable) The "Reset column widths" editor action is not literally
  listed in the ticket's config-surface bullets. It doesn't introduce new storage (PATCHes the
  existing `columnWidths` field to `null`) and is a reasonable, low-risk companion to the new column
  controls — not blocking, but worth a one-line confirmation from the human if they review the PR.
- (Carried from round 1) No existing shared "up/down reorder" control precedent exists in the
  frontend (`TableDisplayFields`'s up/down buttons will be a new interaction pattern). Not a design
  flaw — the ticket explicitly asks for "simple up/down controls" over drag-and-drop — but the
  executor should double check DESIGN.md's button recipes and icon-only-button accessible-name
  guidance since there's no sibling implementation to copy verbatim.
- `design.md` still doesn't explicitly cite DESIGN.md's guidance that consumers should rely on
  `DataGrid`'s default density "unless the surface has a documented reason to diverge" — this
  ticket is exactly that documented reason, so it's compliant, just not cross-referenced. Cosmetic
  only.
