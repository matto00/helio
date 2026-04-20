## 1. Frontend — Dependencies

- [x] 1.1 Install `echarts` and `echarts-for-react` npm packages

## 2. Frontend — ChartPanel Component

- [x] 2.1 Create `frontend/src/components/ChartPanel.tsx` with an ECharts instance using `echarts-for-react`
- [x] 2.2 Set `opts={{ autoResize: true }}` and `style={{ height: "100%", width: "100%" }}` on the ReactECharts element
- [x] 2.3 Define a default empty line chart `option` (placeholder x/y axes, no data series)

## 3. Frontend — Wire into PanelContent

- [x] 3.1 Import `ChartPanel` in `PanelContent.tsx`
- [x] 3.2 Replace the `ChartContent` function and `case "chart"` branch with `<ChartPanel />`
- [x] 3.3 Remove the now-unused `ChartContent` function and its CSS classes from `PanelContent.css`

## 4. Tests

- [x] 4.1 Update `PanelContent.test.tsx` chart-related test cases to expect ECharts output instead of bar skeleton
- [x] 4.2 Add `jest-canvas-mock` if canvas errors appear in any test; mock `ChartPanel` as a fallback if needed
- [x] 4.3 Verify `npm test` passes with no failures
- [x] 4.4 Verify `npm run lint` and `npm run format:check` pass
