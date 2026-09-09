# HEL-469: Per-column cell formatting (number / date / currency)

## Description

`DataGrid` cells are stringified by a single `formatCell` helper (`frontend/src/shared/ui/DataGrid.tsx:128-132`) that renders `—` for null and stringifies otherwise, so table panels show numbers, dates and currency unformatted. `ColumnDef.render(row, value)` (`DataGrid.tsx:31`) already exists as an optional per-column override, so a format spec can drive it without changing the render contract.

## Scope

* Define a per-column format spec (`type: "number" | "date" | "currency" | "text"` plus options — decimal places, currency code/locale, date pattern).
* Build formatter functions mapping spec + raw value to display text (locale-aware via `Intl.NumberFormat`/`Intl.DateTimeFormat`), passed into `DataGrid` as the `ColumnDef.render` override from `TableRenderer`. Non-parseable values fall back to the raw string and never crash.
* Add a per-column formatting control in the table panel's config UI, keyboard operable and accessible (DESIGN.md §8).
* Persist format specs as `columnFormats` on the Output's `TableOutputConfig`.
* Right-align numeric/currency columns per table convention.

## Acceptance criteria

* A column set to `currency` renders `$1,234.56`-style values; `number` respects decimal places and grouping; `date` renders the chosen pattern; `text` is unchanged.
* Unparseable/null values render the raw string or `—` without error.
* Format spec persists across modal open/close and reload.
* **Formatting composes with sort: sort uses RAW values, never formatted text — guarded by a mutation-failable test, not an observation.**
* Jest coverage for each formatter and the fallback path, with locale and timezone PINNED.

## Restated scope (rulings carried from HEL-448/HEL-451 — corrected inline, not re-escalated)

The ticket as filed said to define the spec in `frontend/src/features/panels/types/panel.ts` and persist it on `panel.config` via `panelsSlice.ts`, "mirroring `columnWidths`/`columnOrder`". All of that is stale: HEL-909 retired the bound table panel config (a placement carries only `outputId`), `panelsSlice.ts` has no column-config persist path, and `columnWidths` is local `useState` — not persisted at all.

Carried ruling: **`columnFormats` as a flat sibling on `TableOutputConfig`**, beside `columnSort`; Output-scoped, converging **on load**; **minimal patch** `{ config: { columnFormats } }`, never spreading `output.config` (a per-mount `useOutputMeta` snapshot — spreading makes every edit a lost update); **silent session-local degrade** when the caller cannot write the Output. That extension point was designed under HEL-448 naming this ticket specifically.

## Acceptance criteria adjusted to reality (ruled)

**"applies in exports if exporting is present" — DROPPED.** Verified: there is no row-data export. `exportDashboard` (`dashboardService.ts:68-69`) GETs `/api/dashboards/:id/export` and returns a `DashboardSnapshot` — dashboard/panel structure for re-import, not rendered rows. No CSV or row export exists in `frontend/src`; the `csv` matches are source-KIND labels (`SourceListTable.tsx:43`, `case "csv":`). Formatting has nothing to apply in, so the conditional is removed rather than carried as a hedge nobody could resolve.

**"composes with … filter" — IN SCOPE, superseding the earlier deferral.** That deferral was correct when written (HEL-451 was parked). HEL-451 has since MERGED as `a6bde0d3`, so `columnFilters` exists on `main` and the interface is no longer absent. More than testable, it is now REQUIRED: `tableFilterPredicate.ts` matches on rendered text, so per-column formatting silently breaks filtering unless the predicate resolves the same formatter. See design D6a and tasks 3.5/3.5a/3.6.

## The central trap, and why an observation is not enough

Sort must read raw values. Verified that it does **today**:
* `TableRenderer.tsx:309` — `getValue: (row) => getSortValue(row[col.key])`, the raw row value.
* `DataGrid.tsx:803` — `col.render` is consulted ONLY at the `<td>` site.

Two separate paths over one raw value, so a `currency` column displaying `$1,234.56` sorts on the underlying number and `$9.99` cannot sort above it.

**That establishes the property holds now, not that it will hold.** Routing sort through the rendered value would look like a simplification, and this component has already produced TWO numeric-ordering defects — the second introduced by the fix for the first. The deliverable is therefore a **mutation-failable guard**: point `getValue` at the rendered value and the test must go red. An observation protects nothing.

## The `rawRows` type-loss decision (HEL-1033)

On the `rawRows` branch (the panel detail modal), `usePanelData.ts:87-92` builds rows with `String(v)` **before** `TableRenderer` sees them:
* numbers and dates arrive as parseable strings — recoverable;
* objects arrive as `"[object Object]"` — type destroyed, unrecoverable.

Formatting a value that has already lost its type is not a formatting decision, it is a decision about whether to offer formatting there at all — the same shape as HEL-451's map-column question. **Decide it explicitly in `design.md`**, state that **HEL-1033 owns the underlying fix**, and state that this ticket's behaviour changes when HEL-1033 lands.

## Locale and timezone must be pinned in tests

`Intl.NumberFormat`/`Intl.DateTimeFormat` vary by runtime locale, and dates render as different calendar days either side of midnight by timezone. **A test asserting `"$1,234.56"` passes in `en-US` and fails elsewhere — a defect wearing a green check.** Pin locale and timezone explicitly rather than inheriting the runner's, or CI and a contributor's machine can legitimately disagree. None of locale, timezone or unparseable values is exercised by any existing table-panel test.

## Out of scope

* Conditional/rule-based cell coloring.
* Server-side type inference of columns.
* Formatting on the `preview` variant.
* Row-data export (does not exist). Filter composition is NO LONGER out of scope — HEL-451 merged as `a6bde0d3`; see design D6a.

## Dependencies

Uses the existing `ColumnDef.render` hook. Composes with HEL-448 in-panel sort (merged `adadb5d4`). No `blockedBy`. Binding: DESIGN.md, CONTRIBUTING.md, `.concertino/laws/`.
