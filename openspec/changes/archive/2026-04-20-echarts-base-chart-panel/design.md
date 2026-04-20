## Context

Chart panels currently render a static `ChartContent` function inside `PanelContent.tsx` — five
hardcoded bars with no real charting logic. The rendering switch lives in `PanelContent` which is
called by `PanelCardBody` in `PanelGrid.tsx`. There are no existing ECharts or canvas-charting
packages in the frontend.

## Goals / Non-Goals

**Goals:**
- Mount a live ECharts instance for panels with `type === "chart"`
- Resize the chart correctly when the panel card resizes (react-grid-layout fires CSS resize)
- No console errors on mount or unmount

**Non-Goals:**
- Chart configuration UI, axis labelling, series type selection
- Data binding to real sources

## Decisions

**1. Use `echarts-for-react` as the React wrapper (not a custom ref approach)**
- `echarts-for-react` wraps an ECharts instance in a React component, handles mount/unmount cleanup,
  and exposes an `opts` prop with `autoResize: true` which subscribes to ResizeObserver internally.
- Alternative considered: raw `import * as echarts from 'echarts'` with `useRef` + manual resize
  listener. Rejected: more boilerplate, and ResizeObserver wiring is non-trivial to get right
  across all panel sizes; echarts-for-react already does this correctly.

**2. Replace `ChartContent` with a `ChartPanel` component inside `PanelContent.tsx`**
- `PanelContent.tsx` is the single file that owns type-based rendering. Adding a new internal
  component here (or in a co-located `ChartPanel.tsx`) keeps the pattern consistent with
  `MetricContent`, `TextContent`, etc.
- A dedicated `ChartPanel.tsx` file is preferred for isolation: it has its own import of
  `echarts-for-react` and can grow with future chart config props without cluttering `PanelContent`.
- `PanelContent.tsx` imports `ChartPanel` and routes `case "chart"` to it — one line change.

**3. Default option: empty line chart with placeholder axes**
- Accepted by the ticket as the "sensible default". An empty line chart with no data series, named
  x/y axes, and a legend heading of "Chart" communicates intent without needing data.
- ECharts `option` object is defined as a constant in `ChartPanel.tsx`.

**4. Resize strategy: `opts={{ autoResize: true }}`**
- `echarts-for-react` supports `opts` prop; passing `{ autoResize: true }` enables the built-in
  ResizeObserver path. No additional `ResizeObserver` wiring needed in `PanelGrid`.
- Style `height: 100%` on the wrapper div so the ECharts canvas fills the panel card body.

## Risks / Trade-offs

- [ECharts bundle size] ECharts is ~700 KB minified; tree-shakeable via `echarts/core` imports.
  For this base ticket we import the full bundle for simplicity. A follow-up can tree-shake if
  bundle budget becomes a concern.
  → Mitigation: note the bundle impact in the PR; defer tree-shaking to future work.

- [echarts-for-react test compatibility] Jest runs in jsdom; ECharts uses canvas which is not
  available by default. Existing tests do not render `PanelContent` with `type="chart"` in a way
  that would mount ECharts — but if they do, canvas mock may be needed.
  → Mitigation: add `jest-canvas-mock` if any test failure is observed; or mock `ChartPanel`
  in tests that render the full `PanelContent` tree.

## Planner Notes

Self-approved: frontend-only change, no API or schema changes, straightforward new external
dependency (well-maintained, widely used). No ESCALATION required.
