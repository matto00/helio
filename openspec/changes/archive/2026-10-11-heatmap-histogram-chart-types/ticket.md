# HEL-1311: Charts: add heatmap and histogram chart types

## Description

Found while designing the CI Health dashboard in helio-news: a test x day failure heatmap and a job-duration distribution. Both fell back to bar charts.

Evidence: `frontend/src/features/panels/ui/echartsCore.ts:18` imports/registers only `BarChart, LineChart, PieChart, ScatterChart`; `ChartType` in `utils/chartAppearance.ts` is limited to bar/line/pie/scatter (also the MCP proposal enum at `helio-mcp/src/tools/proposal.ts:74`).

What: add `heatmap` (x, y, value mapping with visualMap) and `histogram` (numeric field, bin count/width) chart types across frontend, schema, backend validation and MCP enums.

## Acceptance criteria

- [ ] A heatmap Output with x/y/value mapping renders with a colour scale in both themes.
- [ ] A histogram bins a numeric field with configurable bin count.
- [ ] The new types appear in the editor, JSON schema and MCP enums, with tests.

## Driver requirements (recorded for downstream gates)

- Red-first tests; a client/server seam test for the new chartType enum values; schema-drift check green.
- Follow DESIGN.md (tokens, both themes); compare against the running app in light and dark, desktop and 375px.
- State whether the "vs" compare overlay and history views apply to the new types.
- No claude.ai session link and no Claude-Session trailer in PR bodies or commits.
