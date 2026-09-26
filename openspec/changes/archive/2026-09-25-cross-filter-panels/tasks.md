## 1. Cross-filter state

- [x] 1.1 Add `crossFilter: SelectionDescriptor | null` to `panelsSlice` state, alongside
      `interactionState`.
- [x] 1.2 Add `setCrossFilter(descriptor)` and `clearCrossFilter()` reducers.
- [x] 1.3 Clear `crossFilter` in the existing dashboard-switch `extraReducers` case
      (`fetchPanels.pending`).
- [x] 1.4 Clear `crossFilter` in `deletePanel.fulfilled` when `action.payload` equals the
      current `crossFilter.panelId` (mirrors `interactionState`'s own precedent).

## 2. Inspect-view filter action (owner ruling: "Action in Inspect")

- [x] 2.1 Add a footer action to `PanelInspectView`, alongside "Clear selection"/"Close":
      "Filter dashboard by {dimension} = {value}" (`.mono` value).
- [x] 2.2 Activating it dispatches `setCrossFilter(selection)` (the same `interactionState`
      selection already driving the Inspect grid) then closes Inspect (same as `onClose`).
      Re-invoking for the identical selection is a no-op (idempotent re-set).
- [x] 2.3 Do NOT change `PanelCard.handleDataPointSelect`/the chart click handler — a click
      continues to open Inspect only, exactly as HEL-572 shipped it.
- [x] 2.4 Test keyboard reachability explicitly: open Inspect via the `ActionsMenu` "Inspect"
      entry (not a chart click) and confirm the filter action is Tab-reachable and operable via
      Enter/Space.

## 3. Row filtering, applied once

- [x] 3.1 Add pure util `filterRowsByDimension(rawRows, headers, dimension, value)`: no-op
      (`-1` index) when `dimension` isn't in `headers`; matches by exact string equality OR
      (when both sides parse as finite numbers) numeric equality — mirrors
      `chartClickSelection.ts`'s `filterRowsForSelection` scatter-branch numeric handling.
- [x] 3.2 Add the filterable-panel check per output kind, using the `output`/`output.config`
      already fetched in `PanelCard` (`useOutputMeta`): table uses `columnOrder` (or all
      loaded headers when absent); every other kind checks `Object.values(fieldMapping)`
      includes the dimension.
- [x] 3.3 In `PanelCard`, after `usePanelData(panel)`, derive filtered `rawRows`/`headers` when
      `crossFilter` is active AND the panel passes 3.2's check AND `panel.id !==
      crossFilter.panelId`; pass the (possibly filtered) values to every existing downstream
      consumer (`PanelContent`, `PanelFullscreenOverlay`, `PanelInspectView`, mobile stack)
      unchanged otherwise.
- [x] 3.4 Confirm manual refresh (HEL-579) and SSE fan-out refetch re-derive the filter from
      fresh rows every render — no stale/cached filtered snapshot.

## 4. Dashboard-level indicator

- [x] 4.1 New `CrossFilterIndicator` component: "Filtered by {dimension} = {value}" (`.mono`
      value per DESIGN.md §3), clear-all button dispatching `clearCrossFilter()`.
- [x] 4.2 `role="status"` / `aria-live="polite"` wrapper so set/replace/clear are announced.
- [x] 4.3 Mount in `PanelList.tsx`, rendered only while `crossFilter !== null`.

## 5. Truncation honesty

- [x] 5.1 Reuse `LoadedScopeDisclosure` (not a new component) wherever `OutputPanelContent`
      renders a cross-filtered, non-origin panel whose own `rowsTruncated` is true.

## 6. Tests

- [x] 6.1 Unit: `filterRowsByDimension` — matching dimension narrows correctly; missing
      dimension is a no-op; a numeric selection ("3") matches a differently-formatted numeric
      cell ("3.0"); empty/zero matches.
- [x] 6.2 Unit: the per-output-kind filterable-panel check — table via `columnOrder` (present
      and absent cases); every other kind via `fieldMapping` values; a panel with an unmapped
      same-named column is correctly excluded.
- [x] 6.3 Unit: `panelsSlice` — set/replace/clear-on-dashboard-switch/clear-on-origin-delete for
      `crossFilter`; re-set with an identical descriptor is a no-op change.
- [x] 6.4 Component: `PanelInspectView`'s new filter action sets the cross-filter, closes
      Inspect, and is keyboard-reachable via the ActionsMenu path.
- [x] 6.5 Unit/component: `PanelCard` — the filter action's effect narrows a sibling panel's
      rendered rows but not the originating panel's own rows; a panel with no matching field
      mapping is unaffected.
- [x] 6.6 Unit/component: metric panel recomputes its displayed value from the filtered subset.
- [x] 6.7 Component: `CrossFilterIndicator` renders, clears, and announces via the live region.
- [x] 6.8 `npm run lint` / `npm test` pass, zero new warnings.

## 7. Live verification

- [x] 7.1 Playwright, against a dashboard with >= 3 Output panels whose field mappings share a
      column plus one that doesn't, and (if available) one sibling with > 200 rows to exercise
      truncation. Screenshots under `.concertino/runs/HEL-588/evidence/` — never the main
      checkout root.
- [x] 7.2 Verify visual cohesion against the RUNNING app in light AND dark themes, toggled
      without navigating away.
- [x] 7.3 Verify cross-filtering also works on a chart panel with no stored `appearance.chart`
      (HEL-1178's known, separate, un-fixed hazard) — do not fix HEL-1178 itself.

## Owner Rulings

- **"Action in Inspect" (2026-09-25).** A chart click opens Inspect only (HEL-572, unchanged);
  Inspect gains an explicit "Filter dashboard by {dimension} = {value}" action that sets the
  cross-filter and closes Inspect. Rejected alternatives: click sets both inspect and filter;
  a dashboard-level cross-filter mode toggle. Reason: explicit, legible opt-in per the ticket, no
  surprise dashboard filtering hidden behind a click that also opens a modal. Cite in the PR body.

## Standing Constraints

- [C1] One lane. Migration ledger: V110 is the highest applied migration; V111 is free but
  not expected to be needed (this change is client-side only) — if you take V111, say so
  explicitly in your report.
- [C2] Write every artifact (code, fixtures, evidence, screenshots) inside this worktree or
  `.concertino/runs/HEL-588/` — never the main checkout root.
- [C3] `files-modified.md` must list EVERY touched file, fixtures included.
- [C4] Every `git commit` invocation uses Bash `timeout: 600000`. Never re-run a commit while
  one is in flight. Never `git add -A`.
- [C5] Proof is red-first: show the relevant test failing before the change, then passing
  after, for every fix/feature claim.
- [C6] If a final-gate REFUTE is addressed with a code change, the evaluator is re-run on the
  new HEAD before the next final-gate re-run and before PR creation (CON-228).
