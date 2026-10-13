# HEL-1395: PanelCard leftovers after the HEL-1365 split: split PanelCard.test.tsx (801 lines), remove dead chart-type selector code, fix stale spec/comments

## Description

origin_kind: followup
origin_ticket: HEL-1365

Found during HEL-1365 (0ebc784be). Verify each before acting.

1. `PanelCard.test.tsx` is 801 lines; split it by the new module boundaries (PanelCardBody / PanelCardHeader / usePanelCardInspect). Tests stay identical.
2. `openspec/specs/chart-type-config-editor/spec.md` (~:8, ~:22) still mentions a chart type selector; HEL-1365 synced `chart-type-selector` to "the panel detail modal shows no chart type selector".
3. `ChartAppearanceEditor`'s chart-type section and the `showChartSection` prop are dead code (`PanelDetailModal` passes `showChartSection={false}`). Remove them, and check HEL-1378 (`buildInitialChart` default) for overlap.
4. Stale comments: `PanelCard.crossFilter.test.tsx:162` says `filteredPaginationRows` is in PanelCard (it's in `PanelContent.tsx`); `usePanelSortFilter.ts:76` says `output` comes from PanelCard's `useOutputMeta` (it's PanelCardBody's).

## Acceptance criteria

* Behaviour-preserving; tests unchanged except moves and imports.
* grep proof for items 2 and 4; dead-code removal leaves lint/typecheck/tests green.

## Driver context (claims, verified in premise-validation.md)

* Re-derived against origin/main 290ab8a22 (after HEL-1444 #982 and HEL-1449 #1005). Drop items already fixed, with evidence.
* Splits preserve behaviour; keep per-file test counts and names (the union of the split files has exactly the base run's 36 tests, same names; 26 `it` plus three `it.each` tables).
