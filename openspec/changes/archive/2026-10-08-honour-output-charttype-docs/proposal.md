## Why

HEL-1304 reported that a chart Output with `config.chartType: "bar"` placed via `place_outputs` rendered as line.
HEL-1351 (#820) has since fixed the render path (`resolvePanelChartType`: panel appearance -> Output -> line, with a
precedence unit test). Still wrong or unproven:

1. AC1 was never measured against the literal repro (API Output -> `POST /api/panels/batch` -> rendered series type).
2. Latent override: a chart patch without `chartType` on a chartless placement merges over `ChartAppearance.Default`
   (`chartType: "line"`), silently storing "line" that then beats the Output's type.
3. AC3 unmet: `place_outputs` says chartType "lives on the Output itself"; `update_panel_appearance` says clearing it
   "renders as the line default".
4. Stale docstrings on the panel-only `resolveChartType` still claim `PanelCard` uses it.

## What Changes

- Backend: a chart patch on a chartless panel merges over the default with `chartType` absent.
- helio-mcp: both descriptions state the precedence and how to change each level.
- Frontend: docstring corrections only.
- Tests: backend merge spec, helio-mcp description test, and an e2e for the literal repro (bar/pie), the panel
  override (AC2), and the partial-patch case (red on main).

## Capabilities

### New Capabilities

### Modified Capabilities
- `panel-appearance-settings`: partial chart merge on a chartless panel leaves `chartType` absent.
- `mcp-panel-composition-tools`: placement/appearance descriptions state the chartType precedence.

## Non-goals

- Changing `resolvePanelChartType` or `ChartAppearance.Default`.
- Migrating stored implicit `"line"` values (indistinguishable from chosen ones).
- The helio-mcp README catalog gap for Output tools.

## Impact

`model.scala`, `PanelAppearanceMergeSpec.scala`, `helio-mcp/src/tools/{placements,write}.ts`,
`frontend/src/utils/{chartAppearance,chartClickSelection}.ts`, new `e2e/hel1304-*.spec.ts`.
