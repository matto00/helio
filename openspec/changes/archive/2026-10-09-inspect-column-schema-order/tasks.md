## Standing Constraints

- [C1] Ordering tests must be red against pre-change code: use the ticket's example schema `date, category, merchant, amount_usd` and assert the exact rendered header order on BOTH the raw-row and aggregate Inspect paths.
- [C2] The hint test (task 2.3) asserts the actual schema/columnOrder values derived from a mocked Output, not mere field presence; the helper skips non-string `columnOrder` entries.
- [C3] PR body states plainly the change is invisible until HEL-1443 lands; reference HEL-1443, file no duplicate.

### Frontend

- [x] 1.1 Add the pure `inspectColumnKeys(rowKeys, schemaNames, columnOrder)` helper per design D1 (dedupe, skip absent, natural-sort leftovers)
- [x] 1.2 Extend `ChartInspectConfig` (`utils/chartClickSelection.ts`) with the optional ordering-hint field (design D2)
- [x] 1.3 Populate the hint in `usePanelCardInspect.ts` from the already-resolved `output` (schema names + `readTableConfig(...).columnOrder`); no new fetch
- [x] 1.4 `PanelInspectView.tsx`: memoise `columns` from `gridRows` + hint and pass to `DataGrid` (both raw and aggregate paths)

### Tests

- [x] 2.1 Unit tests for `inspectColumnKeys`: schema order, columnOrder precedence, stale keys skipped, undeclared keys appended natural-sorted, duplicates ignored
- [x] 2.2 `PanelInspectView` test asserting rendered header order for raw-row and aggregate selection (red against pre-change alphabetical order)
- [x] 2.3 `usePanelCardInspect` (or PanelCard) test proving the hint is derived from the Output's schema/columnOrder
- [x] 2.4 Run lint, typecheck, format:check, and the affected Jest suites
- [x] 2.5 Live check in the running app, light and dark themes: chart panel Inspect shows schema order (done by evaluator cycle 1, evaluation-1.md: schema order shown; schema is alphabetical server-side until HEL-1443)
