# HEL-451: In-panel column filtering

## Description

Table panels rendered by `DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) via `TableRenderer` (`frontend/src/features/panels/ui/renderers/TableRenderer.tsx`) have no way to narrow rows. Filtering is applied client-side over the rows the panel has fetched, composing with the in-panel column sort shipped by HEL-448.

## Scope

* Add a lightweight filter affordance to the `full`-variant `DataGrid`: a single quick-filter text input that matches case-insensitively across visible columns, plus per-column contains-filter inputs.
* Apply filtering in `TableRenderer` over the whole loaded row set, composing with the existing sort in one row-transform pipeline.
* Persist active filter state as `columnFilters` on the Output's `TableOutputConfig`, a flat sibling of `columnSort`.
* Empty-result state: extend the shared `DataGrid` empty state (DESIGN.md §7) with a "no rows match" message and a clear-filters action.
* Accessible: inputs have labels/accessible names; filter controls keyboard operable (DESIGN.md §8).
* The UI must state that filtering and any count describe the LOADED rows, not the whole Output.

## Acceptance criteria

* Typing in the quick-filter narrows rows across all columns live; clearing restores all rows.
* Per-column filter narrows on that column only; multiple column filters AND together.
* Filtered empty state shows the shared empty pattern with a clear action.
* Filter state persists across modal open/close and reload.
* **Counts and the "Load more" affordance describe the LOADED row set, and the UI does not imply otherwise.** (Restated — see below.)
* Jest coverage for the filter predicate and filtered-then-rendered behavior.
* Filtering composes with HEL-448 sort without either regressing.

## Restated scope (owner/coordinator rulings, 2026-09-08 — supersede the original text)

The ticket as filed carried two premises that are false against the live tree, and one requirement that is unsatisfiable under its own constraints.

**1. Rows are NOT fully client-loaded.** `panelThunks.ts:296` carries a comment saying pagination "is sliced on the client", but `:309-311` computes a server-side `offset`/`limit` and `panelsSlice.ts:204-207` APPENDS each fetched page. The initial fetch is 200 rows; each "Load more" adds 50; `Page.MaxLimit` caps a single request at 500. A comment is not evidence.

**2. The persistence route does not exist.** "Persist on `panel.config` (extend `panel.ts` and the persist path in `panelsSlice.ts`, mirroring the `columnWidths` debounced-PATCH idiom)" — HEL-909 retired the bound table panel config, `panelsSlice.ts` has no column-config persist path, and column widths are local `useState`, not persisted at all. Filter state persists Output-scoped as `columnFilters` on `TableOutputConfig`, exactly as `columnSort` does (HEL-448).

**3. "Pagination/counts reflect the filtered set" is UNSATISFIABLE client-side, and has been MOVED, not deleted.** `hasMore` is server-derived (`panelThunks.ts:311`: `offset + pageSize < result.total`, where `result.total` is the Output's total row count). A client-side filter sees only fetched rows and cannot know how many of the UNFETCHED rows match, so no client-side implementation can make a count describe the filtered set.

`fetch-all-before-filter` was considered and **rejected on performance**, not on scope: at `Page.MaxLimit = 500`, a 10,000-row Output means 20 sequential requests on every panel a user filters — a deliberate regression on exactly the large Outputs where filtering matters most. `CLAUDE.md` makes optimizing for performance a default obligation in both frontend and backend paths, and this is the same trade already refused for sort (gating the control on a fully-loaded set).

The requirement now belongs to **HEL-1027** (verified open; retitled `Server-side sort, filter and counts for Output rows`), which explicitly owns a filter parameter on `GET /api/outputs/:id/rows`, a filtered total, and the removal of this ticket's loaded-scope disclosure once counts are genuinely whole-Output.

**Restated AC:** counts and the "Load more" affordance describe the **loaded** row set, and the UI must not imply otherwise.

## Inherited rulings (from HEL-448 — not re-litigated here)

* `columnFilters` is a **flat sibling** beside `columnSort` on `TableOutputConfig`. `OutputService.mergeConfig` deep-merges only four hardcoded chart keys, so a nested container would be replaced wholesale on every patch.
* **Output-scoped**, converging **on load**, not live. Two panels bound to one Output cannot hold different filters across a reload. Never described as per-panel.
* **Minimal patch** `{ config: { columnFilters } }` — never spread `output.config`, a per-mount `useOutputMeta` snapshot never refreshed after a write; spreading makes every filter change a lost update.
* **Silent session-local degrade** when the caller cannot write the Output (`updateOwned` is RLS owner-only). No toast, no hint, no owner-only restriction.
* **Client-side only.** No filter parameter on `GET /api/outputs/:id/rows`.

## Design obligations this ticket must answer, not defer

**Honesty under sampling.** Filtering a 200-row sample of a 10,000-row Output filters a SAMPLE. A filter yielding 3 of 200 loaded rows must not present as "3 results" — the user's question was "how many EMEA rows are there", and anything that looks like a count answers it wrongly. The **empty case is sharpest**: a filter matching nothing in the loaded rows, on a value with thousands of upstream matches, renders by default as a bare empty table — a confident answer, and wrong, with no signal at all. `DataGrid`'s empty state is a bare `<p>{emptyText}</p>` with no action slot (`DataGrid.tsx:230-231`); that is not merely an inconvenience for the clear-filters button, it is the surface where honesty has to live.

HEL-448's qualifier (`Sort covers only the loaded rows.`, shown only when truncated) is a **precedent to extend, not a template to copy**, and it remains **pending the owner's confirmation — not approved**.

**Map-classified columns.** HEL-1015 (`36a9c1cc`, backend-only) made `JsonFlattener` classify nested-object paths MAP vs STRUCT cross-row (`detectMapPaths`, `MapCoverageThreshold = 0.25`, `MinObjectRowsForMapClassification = 2`). A path whose keys are DATA no longer explodes into one column per key, so map-classified paths arrive as a SINGLE column carrying map-shaped values. A "contains" filter over such a column substring-matches serialized JSON, producing matches a user can neither predict nor explain. This ticket must decide explicitly what filtering such a column means — **including whether to offer it at all** — and justify it. "Do not offer it" is a legitimate answer if justified; an unexplainable match is worse than an absent feature.

## Out of scope

* Typed operators (>, <, ranges, date pickers) — contains/equality only.
* Server-side filter endpoint, and whole-Output counts (both owned by HEL-1027).
* Filtering on the `preview` variant.

## Dependencies

Composes with HEL-448 in-panel column sort (merged `adadb5d4`) — shares the row-transform pipeline in `TableRenderer`. Binding: DESIGN.md, CONTRIBUTING.md, `.concertino/laws/`.
