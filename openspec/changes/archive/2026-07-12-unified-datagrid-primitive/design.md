## Context

Five surfaces render table-shaped data with independent markup/CSS today: `PreviewTable.tsx`
(shared, used by `TypeDetailPanel`, `SourceDetailPanel`, `PipelinePreviewModal`), an inline
`<table>` in `StepCard.tsx` (rendered inside `PipelineDetailPage`; class prefix
`pipeline-detail-page__step-preview-*` — the markup lives in `StepCard.tsx:237-259`, not
`PipelineDetailPage.tsx`), a schema-preview `<table>` in `SqlTab.tsx:210-227`, and
`TableRenderer.tsx` (paginated table-panel body). HEL-240 (parent epic) needs one canonical grid
before it can add density controls, draggable column widths, a scroll fix, and table-panel config
in follow-on tickets. This is a frontend-only consolidation — no backend/schema changes.

This is a rebuild against current `main` (83ee240) of a design the prior attempt (now-deleted,
32-commit-stale branch) already validated through 3 skeptic-design rounds (`CONFIRM`). All 5
target surfaces were re-read fresh against current `main`, since `StepCard.tsx`,
`TypeDetailPanel.tsx`, and `SourceDetailPanel.tsx` all changed substantially this session
(text-op step configs, HEL-217 content field types, connector changes) — none of those changes
touch the table-rendering code paths this change migrates.

## Goals / Non-Goals

**Goals:**
- One `DataGrid` component renders every listed surface; all bespoke `<table>` markup and CSS in
  those five surfaces is deleted.
- Preserve each surface's current per-surface empty-state copy (via `emptyText`) and pagination
  "Load more" behavior — a structural consolidation, not a UX change, with one deliberate
  exception (cell-formatting normalization; Decision 3).
- Cover empty state, full mode, preview mode, and custom column render in tests.

**Non-Goals:**
- No density toggle, draggable widths, virtualization, or sorting — later HEL-240 tickets.
- No change to `RunHistoryModal` (not a `<table>`; Planner Notes) or to
  `TypeDetailPanel`/`SourceDetailPanel`'s non-preview schema tables (editable / pre-existing
  read-only surfaces the ticket doesn't name; Planner Notes).
- No behavior change to any existing capability spec (`panel-type-rendering`,
  `pipeline-step-preview`) — those describe outcomes ("shows column headers and data rows"),
  preserved, aside from Decision 3's acknowledged cell-formatting delta.

## Decisions

**1. Location: `frontend/src/shared/ui/DataGrid.tsx`, not `components/ui/`.**
The ticket sketches `frontend/src/components/ui/DataGrid.tsx`, but the codebase's actual shared
primitive layer is `frontend/src/shared/ui/` (`EmptyState`, `Modal`, `Select`, `TextField`,
`Textarea`, `Toast`, barrel-exported from `shared/ui/index.ts`). No `components/ui/` directory
exists (re-confirmed on current `main`). Using the established convention; CSS class prefix
follows the existing `ui-<component>` convention (`ui-data-grid`, matching `ui-empty-state`).

**2. Column derivation: union of first 50 rows' keys, matching `PreviewTable`'s current logic.**
`PreviewTable.tsx:17-24` already derives headers this way when no explicit headers are given.
Reusing it verbatim in `DataGrid` avoids a silent behavior change for the three `PreviewTable`
call sites.

**3. `ColumnDef.render` covers all current custom-cell needs; `DataGrid`'s default formatter
normalizes cell display across all five surfaces — a deliberate, acknowledged behavior change.**
`PreviewTable.tsx:54-58`'s default `formatCell` (null/undefined → `—`, objects →
`JSON.stringify`) becomes `DataGrid`'s single default formatter. This differs from two other
surfaces' current inline formatting: `TableRenderer.tsx:37` and `StepCard.tsx:253` currently
render null/undefined as `""` (blank) and would render non-null objects as bare `String(value)`
(→ `"[object Object]"`), not `—`/JSON. Unifying is the explicit point of this ticket and
blank/`"[object Object]"` cells are objectively worse than `—`/JSON — adopted intentionally, not
silently. The **one acknowledged visual delta** in this change; call out in the PR description.
`SqlTab`'s `Nullable` column (`f.nullable ? "yes" : "no"`) and any other genuinely custom cell go
through `ColumnDef.render`, which fully overrides the default for that column.

**3a. `emptyText?: string` prop, default `"No data to preview."` (matching `PreviewTable`'s
current default).** Four surfaces pass distinct copy: `TypeDetailPanel.tsx:198` ("No rows have
been written to this type yet. Run a pipeline that writes to this type to populate it."),
`SourceDetailPanel.tsx:130` ("Source returned no rows."), `PipelinePreviewModal.tsx:40`
("Pipeline returned no rows."), `StepCard.tsx:235` ("No rows to preview."). Each call site passes
its existing copy forward so none regress to a generic message.

**4. Pagination stays outside `DataGrid`.**
`TableRenderer`'s "Load more" button/loading state is footer UI belonging to the *table-panel*
surface, not the grid primitive. `TableRenderer` becomes a thin wrapper rendering
`<DataGrid variant="full" rows=... />` followed by the existing load-more control.

**5. `variant="preview"` defaults `density="condensed"`; `variant="full"` defaults `"normal"`.**
Matches current visual weight: preview surfaces are already condensed relative to
`TableRenderer`'s full table-panel body. `density` remains overridable.

**6. `PipelinePreviewModal`'s "not yet run" message gets its own local class.**
`PipelinePreviewModal.tsx:35` renders `<p className="preview-table__empty">` directly — reusing
`PreviewTable.css`'s empty-state class for a state that never touches the `PreviewTable`/
`DataGrid` component at all (the "no `rows` prop yet" branch, before any run). This is a new
finding versus the prior design (not previously called out): once `PreviewTable.css` is deleted,
this paragraph loses its style. Give `PipelinePreviewModal` its own small stylesheet
(`PipelinePreviewModal.css`) with an equivalent `.pipeline-preview-modal__empty` rule (same
tokens: `var(--app-text-muted)`, `var(--text-xs)`), imported alongside the component.

**7. `TableRenderer`'s "raw rows" path converts `string[][]` + optional `headers` into
`DataGrid`'s `rows`/`columns` contract at the wrapper boundary, preserving the current
positional-label fallback.** `TableRenderer.tsx:70-94` operates on `rawRows?: string[][]` +
`headers?: string[] | null`, not `Record<string, unknown>[]` — a shape `DataGrid` cannot accept
directly (found in skeptic-design round 1; the ported `DataGrid` has no positional/array-row
support). Convert at the `TableRenderer` wrapper, mirroring the existing column-labeling logic
exactly:
```
const cols = headers ?? rawRows[0].map((_, i) => String(i + 1));
const columns: ColumnDef[] = cols.map((key) => ({ key }));
const rows = rawRows.map((row) => Object.fromEntries(cols.map((key, i) => [key, row[i]])));
```
Passing `columns` explicitly (rather than relying on `DataGrid`'s key-union derivation) preserves
the exact current column order and the positional `"1"`, `"2"`, ... fallback labels when `headers`
is absent — required by `PanelContent.test.tsx`'s headers-omitted case (`rawRows={[["A"],["B"],
["C"]]}`, no `headers` prop). Cell values stay plain strings (from `string[][]`), so `DataGrid`'s
default formatter (`String(value)`) renders them identically to the current `{cell}` output; no
`ColumnDef.render` needed for this path.

## Planner Notes

- **Self-approved: component location** — see Decision 1.
- **Self-approved: "Run history's row-count column" excluded from migration.**
  `RunHistoryModal.tsx:44-46` renders `run.rowCount` inside a flex-row summary
  (`run-history-modal__row-count`), not a `<table>` — re-confirmed on current `main`. Read as the
  numeric-formatting convention, which `DataGrid`'s default formatter now centralizes for actual
  tables; `RunHistoryModal` is unchanged.
- **Self-approved: `TypeDetailPanel`'s editable field-schema table
  (`type-detail-panel__table`, lines 100-148) and `SourceDetailPanel`'s read-only inferred-schema
  table (`source-detail-panel__schema-table`, lines 96-113) stay out of scope.** Neither uses
  `PreviewTable`, neither is named in the ticket, and both pre-date this session's changes to
  those files (confirmed via `git show` against the prior branch's tip, 3fdabcb — the
  `source-detail-panel__schema-table` markup is byte-identical there). Migrating them would be
  scope creep beyond the ticket's 5 named surfaces; each remains a candidate for a future HEL-240
  ticket.
- **`SourceDetailPanel.tsx:127-131` passes explicit `headers: string[]` to `PreviewTable`**, not a
  `ColumnDef[]`. Migration maps each string to `{ key: h }` at the call site.
- **`SqlTab.tsx:204-233` already guards** its whole schema-preview table behind
  `inferredFields.length > 0`, rendering a separate paragraph for the zero-fields case. Kept as-is
  post-migration — `DataGrid` never receives an empty array here.

## Risks / Trade-offs

- [Risk] `SqlTab`'s schema-preview rows are `InferredField[]` (`{name, dataType, nullable}`), not
  directly assignable to `rows: Record<string, unknown>[]`. → Cast at the call site (plain data,
  no methods/symbols); the `Nullable` column becomes a `ColumnDef.render`.
- [Risk] Deleting `PreviewTable.css` / per-surface table CSS could leave orphaned class
  references. → Grepped every consumer of `preview-table`/`preview-table__*` classes across
  `frontend/src` (not just `PreviewTable.tsx`/`.css`); found `PipelinePreviewModal.tsx:35`'s
  direct reuse (Decision 6) as the one non-obvious dependency. Evaluator re-verifies no other
  orphaned references remain after deletion.
- [Risk] `TableRenderer`'s three render paths (paginated rows, raw rows, unbound-skeleton) must
  not collapse into one behavior. The skeleton path (`TableRenderer.tsx:95-120`, a 3-row × 2-col
  `aria-hidden` placeholder) fires when both `rawRows` and `paginationRows` are
  `null`/`undefined` (no `typeId` bound), per `panel-type-rendering`'s "Unbound table panel
  renders a table skeleton" scenario — a *different* case from `DataGrid`'s own empty state
  (bound + fetched + zero rows). → The `TableRenderer` wrapper keeps the skeleton as bespoke
  sibling markup for the "no rows prop at all" case (never routed through `DataGrid`); a
  bound-but-empty rows array would reach `DataGrid`'s empty state via this contract, though in
  practice `PanelContent`'s upstream `noData` check (from `usePanelData.ts`) already intercepts
  the bound-but-empty case with its own "No data available" state before `TableRenderer` renders
  at all — `DataGrid`'s empty state remains reachable for other callers, just not exercised by
  this particular call site today.

## Migration Plan

Port the already-built `DataGrid` primitive + tests (net-new files, no conflict with current
`main`), then migrate surfaces in ticket order (`PreviewTable` call sites → `StepCard` step
preview → `SqlTab` → `TableRenderer`), fixing `PipelinePreviewModal`'s orphaned CSS class
(Decision 6) as part of its call-site migration, deleting each surface's bespoke table
markup/CSS as it's migrated. No feature flag or rollback plan needed — a like-for-like UI swap
behind existing routes (with the one acknowledged cell-formatting normalization from Decision 3),
verified by the existing Jest/RTL suites plus new `DataGrid` unit tests.
