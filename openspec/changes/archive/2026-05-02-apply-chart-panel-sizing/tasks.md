## 1. Frontend

- [x] 1.1 Add `.panel-content--chart` CSS rule to `PanelContent.css` with `padding: 0` to override base `.panel-content` padding
- [x] 1.2 Wrap `<ChartPanel>` return in `PanelContent.tsx` chart case with `<div className="panel-content panel-content--chart">`

## 2. Tests

- [x] 2.1 Verify existing `ChartPanel` tests still pass after wrapper change (`npm test -- --testPathPattern=ChartPanel`)
- [x] 2.2 Verify full test suite passes (`npm test`)
- [x] 2.3 Run lint and format checks (`npm run lint && npm run format:check`)
