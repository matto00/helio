# Panels

Panel rendering, editing, and grid layout: `state/` (`panelsSlice.ts` plus
narrowing/payload/shape/slot/template/thunk helpers), the API client
(`services/panelService.ts`), `types/panel.ts`, `hooks/` (create/update
actions, polling, data fetching, layout save), and `ui/` — per-panel-type
renderers (`ChartPanel`, `TablePanel`-family via `renderers/`,
`DividerPanel`, `ImagePanel`, `MarkdownPanel`), the grid (`grid/`), creation
flow (`creationSteps/`, `creators/`), config editors (`editors/`), and the
detail modal (`detailModal/`).

**Belongs here:** panel state, per-type rendering/config, and the grid layout
that positions panels.
**Does not belong here:** the dashboard-level appearance/layout persistence
wrapper, which lives in `dashboards`; the data-binding source (pipelines/data
types), which lives in `pipelines`/`dataTypes`.
