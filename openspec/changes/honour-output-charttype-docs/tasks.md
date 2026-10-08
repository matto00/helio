## Standing Constraints

- [C1] Never edit `.github/workflows/ci.yml`, root `package.json`/lockfile or `.audit-ci.jsonc` (concurrent lanes).
- [C2] e2e evidence paths only via `e2e/support/evidencePath`; seeded rows recorded and cleaned by exact id.
- [C3] Test parallelism capped at 3-4 workers under `nice -n 19`; no writes under `~`.

### Backend

- [x] 1.1 `model.scala` `PanelAppearance.applyPatch`: chartless base is `ChartAppearance.Default.copy(chartType = None)`
- [x] 1.2 Update the `applyPatch` / `ChartAppearance.Default` scaladocs to state the chartless-base rule

### Frontend / helio-mcp

- [x] 2.1 `helio-mcp/src/tools/placements.ts`: rewrite the `place_outputs` chartType sentence per the spec delta
- [x] 2.2 `helio-mcp/src/tools/write.ts`: `update_panel_appearance` null-chartType sentence renders the Output's type
- [x] 2.3 Correct `resolveChartType` docstring in `frontend/src/utils/chartAppearance.ts` and `chartClickSelection.ts`

### Tests

- [x] 3.1 `PanelAppearanceMergeSpec`: legend-only chart patch on a chartless panel stores `chartType = None` (red first)
- [x] 3.2 `PanelAppearanceMergeSpec`: existing pie-on-chartless and stored-chart cases still pass unchanged
- [x] 3.3 helio-mcp test asserting both descriptions state the precedence (and `place_outputs` drops "lives on the Output itself")
- [x] 3.4 `e2e/hel1304-output-charttype-render.spec.ts`: batch-placed bar/pie Outputs render bar/pie (AC1)
- [x] 3.5 Same spec: panel `chartType: "line"` override renders line (AC2); legend-only patch still renders bar (red on main)
- [x] 3.6 Run `sbt testFull` (scoped), helio-mcp tests, frontend lint/typecheck, and the new e2e; record results
