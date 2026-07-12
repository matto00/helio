## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

**Ground truth setup**
- `git log --oneline -3` → HEAD `df79958 HEL-251 Build unified DataGrid primitive, migrate 5 table surfaces`, parent `83ee240` (matches the claimed base). `git status` shows only `workflow-state.md` (modified) and `evaluation-1.md` (untracked, not read per protocol).
- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/data-grid/spec.md`, `workflow-state.md`, `files-modified.md`, `skeptic-design-{1,2}.md` in full for context, treated as claims to re-verify, not fact.

**All 5 required surfaces re-verified against current source (not the plan)**
- `git diff 83ee240..df79958 --stat` and full diffs of every touched file, read directly:
  - `TypeDetailPanel.tsx` (196-200): `PreviewTable` → `<DataGrid variant="preview" ... />`, `emptyText` preserved verbatim.
  - `SourceDetailPanel.tsx` (124-131): `PreviewTable` → `<DataGrid variant="preview" columns={previewHeaders?.map((h) => ({ key: h }))} ... />`.
  - `PipelinePreviewModal.tsx`: `PreviewTable` → `<DataGrid variant="preview" rows={rows} emptyText="Pipeline returned no rows." />`; sibling "not yet run" `<p>` reclassed from `preview-table__empty` to `pipeline-preview-modal__empty`, new `PipelinePreviewModal.css` added and imported.
  - `StepCard.tsx` (231-258): inline `<table>` fully replaced by `<DataGrid variant="preview" rows={previewRows} emptyText="No rows to preview." />`; the manual `previewRows.length === 0` branch removed (now covered by `DataGrid`'s own empty state) — confirmed no dangling reference to the removed `pipeline-detail-page__step-preview-empty` class (also removed from `PipelineDetailPage.css`).
  - `SqlTab.tsx`: inline `add-source-modal__fields-table` → `<DataGrid variant="preview" rows={inferredFields as unknown as Record<string, unknown>[]} columns={INFERRED_FIELD_COLUMNS} />` with `Nullable` as `ColumnDef.render`.
  - `TableRenderer.tsx`: both data-bearing paths (paginated, raw rows) now render `<DataGrid variant="full" .../>`; raw-rows path implements Decision 7's exact conversion (`cols = headers ?? rawRows[0].map((_, i) => String(i+1))`, `columns`, `rows` via `Object.fromEntries`) — byte-for-byte match to the design-gate-approved formula. The aria-hidden 3×2 skeleton (unbound-panel case, lines 63-88) is **untouched** (confirmed identical to `main` via diff — zero lines changed in that block), consistent with the design's explicit non-goal of routing it through `DataGrid`.
- Live UI, both themes, real backend data (dev servers started via `scripts/concertino/start-servers.sh`, `assert-phase.sh servers` → `PASS`):
  - Table panel (paginated rows): dashboard "HEL-297 UI Check" → "HEL-251 Table Check" panel, `region "Data grid"` renders a real 5-column/26-row table. Light + dark screenshots taken; **pixel-sampled** (not just eyeballed) at multiple coordinates in both — light: `(253,246,240)`-range background; dark: `rgb(26,24,22)`/`rgb(22,21,20)` matching `theme.css`'s `--app-surface`/`--app-surface-soft` dark values exactly.
  - `TypeDetailPanel` preview (`EvalChunkType`): real 26-row preview grid rendered below the editable schema table, light + dark, pixel-sampled dark confirmed (`rgb(26,24,22)` at multiple points).
  - `SourceDetailPanel` preview (`Regression CSV`, explicit `headers`): clicked "Preview" live, got a real 2-column (`a`,`b`)/2-row grid — confirms the `headers.map((h) => ({key: h}))` conversion works end-to-end, not just in isolation. Light + dark pixel-sampled.
  - `SqlTab` schema preview (Add Source Modal → SQL Database → filled real local Postgres creds from `backend/.env` → "Test connection"): got a live "Connection successful — 2 fields inferred" `DataGrid` with `Field name/Type/Nullable` columns and `id`/`name` rows, `Nullable` correctly rendered as `no` via `ColumnDef.render`. Verified in both light and dark (dark pixel-sampled `rgb(16,15,13)` background, matching tokens).
  - `StepCard` step preview (`Eval SplitText Pipeline` → "Split text" step → "Preview data"): live 4-column/7-row preview table rendered inline in the step card, in both themes. Initial visual inspection of the dark screenshot looked anomalously light to me — I did **not** trust that single read; I re-verified via `getComputedStyle` (`rgb(35,32,25)`/`rgb(26,24,22)`, i.e. `--app-surface-raised`/`--app-surface` dark values) and direct pixel sampling of the PNG (`(35,32,25)`, `(26,24,22)`, `(18,17,16)` at multiple coordinates) — confirmed genuinely dark-themed; my initial visual impression was unreliable, the pixel data is authoritative and correct.
  - `PipelinePreviewModal` "not yet run" state (Decision 6): opened via "Preview" on a 0-step pipeline, confirmed the muted-gray message renders correctly styled in both light and dark via `.pipeline-preview-modal__empty` (own local class, not the deleted `preview-table__empty`).

**Deletion / no-orphan verification (re-grepped myself, not trusted from files-modified.md)**
- `frontend/src/features/panels/ui/PreviewTable.tsx`/`.css`: confirmed deleted (`ls` fails). `grep -rn "PreviewTable" frontend/src` → one hit, a comment in `DataGrid.tsx` referencing the old component's former behavior — no live import/usage anywhere.
- `grep -rn "preview-table" frontend/src` (class-name grep, not just component-name) → zero hits anywhere in `frontend/src`.
- `grep -rn "step-preview-empty\|step-preview-table"` → zero hits (both markup and CSS fully removed together).
- `add-source-modal__fields-table` (SqlTab's old class) is **still present** in `InferredFieldsTable.tsx` and `StaticSourceForm.tsx` — read both files in full: these are genuinely distinct, editable data-entry tables (`TextField`/`Select`/checkbox/remove-button cells for schema editing and static-source row entry), not read-only preview surfaces, and neither is one of the ticket's 5 named surfaces (analogous to the already-excluded `TypeDetailPanel`/`SourceDetailPanel` editable schema tables). Legitimately out of scope; the CSS class and its rules in `AddSourceModal.css` are correctly still in use, not orphaned.
- `.panel-content__table` CSS retained in `PanelContent.css` per the documented tasks.md-3.4 deviation — re-verified `TableRenderer.tsx:65` still renders `<table className="panel-content__table" aria-hidden="true">` for the skeleton path, so keeping this CSS (rather than deleting per the original task wording) is correct, not an oversight.

**Gates re-run myself, fresh (not trusting the evaluator's self-report)**
- `npm test` (frontend): **77 suites / 851 tests passed**, 0 failures.
- `npm run lint` (`eslint src --max-warnings=0`): clean, zero output.
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run build` (vite): succeeded, no errors (only a pre-existing chunk-size advisory, unrelated).
- `npm run check:schemas`: "schemas in sync with JsonProtocols" — clean (no backend/schema changes expected or found).
- `npm run check:scala-quality`: clean (41 pre-existing soft line-count warnings on unrelated backend test files, not touched by this change).

**Pre-commit bypass claim independently reproduced**
- Ran `npm run check:openspec` myself: fails with exactly the one claimed issue — `change "unified-datagrid-primitive" is complete (16/16) but not archived`. Combined with the six gate re-runs above (lint/format/test/schemas/scala-quality all independently clean), this confirms the `git commit -n` bypass on `df79958` was limited to the expected pre-archive hygiene check and did not skip any substantive enforcement.

**DESIGN.md token compliance**
- `DataGrid.css` and `PipelinePreviewModal.css` (the two new stylesheets) use only `--app-*`/`--space-*`/`--text-*` tokens for color/spacing/type; the only literal-px values are `1px` border widths and `max-height: 320px`/`max-width: 240px` layout constraints — consistent with existing codebase convention (e.g. the pre-existing, now-deleted `pipeline-detail-page__step-preview-td` used an identical `max-width: 200px` pattern), not a token violation.

**Test coverage (DoD: empty/full/preview/custom-render)**
- Read `DataGrid.test.tsx` in full: covers empty state (default + custom `emptyText`, asserts no `<table>`), column derivation (union-of-keys vs. explicit override), full/preview variant + density defaulting/override, default cell formatting (null/undefined → `—`, object → JSON, other → `String`), and custom `ColumnDef.render` override. All scenarios in `specs/data-grid/spec.md` are covered.
- No existing test file for the 6 migrated surfaces needed changes (confirmed via `git diff --stat -- '*.test.tsx'` showing only the new `DataGrid.test.tsx`) — checked that none of those tests asserted against the now-deleted CSS classes (`grep` for `preview-table`/`step-preview-table`/etc. in `*.test.tsx` → zero hits), so "no diff needed" is a legitimate outcome, not a shortcut; the full suite passing independently confirms this.

### Minor non-blocking observation
- `TableRenderer`'s paginated-rows path previously derived columns via `Object.keys(paginationRows[0])` (first row's keys only); after migration it relies on `DataGrid`'s default derivation (union of keys across the first 50 rows). This is a theoretical behavior delta not explicitly cataloged in design.md (which only calls out the raw-rows path, Decision 7, and the `SqlTab`/`SourceDetailPanel` shape mismatches) — in practice paginated rows from a single query share a uniform shape, so this is inert, and the full test suite (including `PanelContent.test.tsx`'s paginated-rows assertions) passes. Not blocking; worth a one-line mention in a future design doc for completeness.
- `InferredFieldsTable.tsx`/`StaticSourceForm.tsx` reusing `add-source-modal__fields-table` (same class SqlTab used to inline) were not explicitly named in design.md/tasks.md as "considered and excluded," unlike the analogous `TypeDetailPanel`/`SourceDetailPanel` editable-table exclusions. They are clearly out of scope on inspection (editable, not preview surfaces), so this is a documentation-completeness nit only, not a functional gap.

### Verdict: CONFIRM

All 5 required surfaces are verified rendering through the real `DataGrid` component (via source diff and live, pixel-verified UI in both themes), `PreviewTable` and its CSS are fully deleted with no orphaned references, Decision 6 and Decision 7 are both correctly and verifiably implemented, the full gate suite (test/lint/format/build/schemas/scala-quality) passes on fresh re-run, the pre-commit bypass is confirmed limited to the expected hygiene check, and DESIGN.md token compliance holds in all new CSS. Ships.

### Non-blocking notes
- See the two observations above (paginated-column-derivation delta, undocumented-but-correct InferredFieldsTable/StaticSourceForm exclusion) — neither blocks delivery.
