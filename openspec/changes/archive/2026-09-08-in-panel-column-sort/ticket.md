# HEL-448: In-panel column sort

## Description

The unified `DataGrid` primitive (`frontend/src/shared/ui/DataGrid.tsx`) renders table panels via `TableRenderer` (`frontend/src/features/panels/ui/renderers/TableRenderer.tsx`). It already supports column resize (HEL-253), density, and visible-column ordering (HEL-255), but rows render in their raw source order with no way to sort.

Sort is performed client-side over the rows the panel has loaded; no new backend endpoint is required.

## Scope

* Add sortable column headers to `DataGrid` (`full` variant only), built from HEL-1022's shared sorting system: activating a header toggles ascending <-> descending, using the shared direction glyph.
* Sort comparator: numeric-aware (values that parse as numbers sort numerically; otherwise locale string compare), with null/undefined (`—` cells) sorted last in both directions. Stable sort.
* Apply sort in `TableRenderer` across the whole loaded row set, so sort is global over every row the panel has loaded rather than reordering only what is currently visible.
* Persist sort state as `columnSort: { key, direction }` on the Output's `TableOutputConfig` (`frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`), alongside the existing `columnOrder`, so a sorted table reopens sorted.
* Keyboard operable: header sort toggle reachable and activatable via keyboard (Enter/Space), with an accessible name and `aria-sort` on the `th` per DESIGN.md §8.
* Sort control must not interfere with the existing resize handle (the resize `<span>` already stops propagation).

## Acceptance criteria

* Clicking/keyboard-activating a table column header sorts every loaded row; a second activation reverses. (Owner ruling 2026-09-08: the cycle is TWO-STATE — `asc` <-> `desc`, no third clearing activation. See "Restated scope" below.)
* `aria-sort` reflects the active column/direction; direction indicator visible.
* Sort persists across panel detail-modal open/close and page reload.
* Numeric columns sort numerically, not lexically; blank cells sort last.
* No regression to column resize, density, or column-order.
* Jest coverage for the comparator and for `TableRenderer`'s sort-then-render ordering.
* The new sort affordance is visually cohesive with the resize and density affordances already rendered by `DataGrid`, verified against the running app in both light and dark themes — not against tokens alone.

## Restated scope (owner ruling, 2026-09-08 — supersedes the original ticket text)

The ticket as filed said to persist sort on `panel.config` by extending `frontend/src/features/panels/types/panel.ts` and the `panelsSlice.ts` persist path, "following the debounced-PATCH idiom already used for `columnWidths`". Premise validation found all three of those citations stale: HEL-909 (P1.6) retired the bound table panel config, `panelsSlice.ts` has no column-config persist path, and column widths are held in local `useState` and are not persisted at all.

The owner ruled **Output-scoped persistence**: sort state lives on `TableOutputConfig` beside `columnOrder`. Table config must NOT be re-introduced onto the placement record — HEL-909 removed it deliberately and that decision stands.

**Accepted consequence:** sort follows the Output into every panel bound to it, so two panels bound to the same Output cannot sort differently. This is accepted, not overlooked. It must be stated plainly in the PR body and on the Linear ticket, and must never be described as per-panel anywhere in code, comments, or docs.

**Lane-wide extension point:** HEL-451 (in-panel column filtering), HEL-465 (column pinning) and HEL-469 (per-column cell formatting) hit the identical question and all resolve the same way — Output-scoped on `TableOutputConfig`. This ticket is first of four, so the shape added to `TableOutputConfig` must leave clean room for filter/pinning/formatting state to land beside it. Those three are NOT built here; they must simply not be painted into a corner.

## Corrected premise note (minor staleness, corrected inline)

The ticket's context said rows "are fully loaded on the client and sliced for pagination", citing `panelThunks.ts` `fetchPanelPage`. That comment exists verbatim at `panelThunks.ts:296` but does not describe the current code: `fetchPanelPage` calls `getOutputRows(outputId, offset, pageSize)` with a server-side `offset`/`limit`, and `panelsSlice.ts` APPENDS each page onto `paginationState[panelId].rows` on load-more. The client therefore holds only the pages loaded so far, not the full row set, and there is no client-side slice to sort "before".

This does not change any acceptance criterion — sorting the accumulated loaded-row set is exactly "sorts every loaded row" — but the design must describe the real mechanism, and must be honest that sort covers loaded rows only (loading more appends server-order rows that then sort into place).

## Out of scope

* Multi-column sort.
* Server-side sort endpoint.
* Sort on the `preview` DataGrid variant.

## Dependencies

Builds on HEL-253 / HEL-255 (DataGrid resize/density/column-order). Binding: DESIGN.md (§6 shared components, §8 accessibility), CONTRIBUTING.md, `.concertino/laws/`.


## Second re-baseline (owner rulings, 2026-09-08 — after rebase onto 6b081b86)

`main` moved to `6b081b86` (HEL-1022) mid-Planning, shipping a SHARED SORTING SYSTEM
(`useSortedRows`, `SortableTh`, `SortableTable`; DESIGN.md ~452-475, ~520-540). This ticket is
therefore an EXTENSION of an existing feature, not a greenfield one: no new comparator, no new sort
glyph, no new header affordance, no new sort-state shape.

**RULING 1 — two-state, reuse `useSortedRows` as-is.** `toggleSort` cycles `asc` <-> `desc` only;
`SortState<Key>` has no "none" variant and `defaultSort` is required, so unsorted is not
representable in that type. Three-state would have needed either extending the hook (changing the
four list tables HEL-1022 just shipped) or forking it (a divergent second dialect). Reuse wins.
Accepted cost, stated in the PR body: once sorted, no click returns the table to the pipeline's own
row order. No affordance is invented for it; if it matters it is a follow-up ticket.

**RULING 2 — non-owner writes degrade silently to session-local.** The Output config write is RLS
owner-only, so a shared-dashboard grantee would otherwise error on every sort click. Suppress the
write, keep the sort on screen, no toast, no owner-only restriction, no hint affordance.

**Naming:** the persisted key is `columnSort`, not `sort` — `TimelineOutputConfig.sort` already
exists in the same config module and would have been inherited three more times by this lane.

**Convergence is on load, not live:** panels bound to one Output do not re-sort each other in a
session; they converge next time they load.
