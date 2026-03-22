## 1. PanelContent Component

- [x] 1.1 Create `frontend/src/components/PanelContent.tsx` with a `PanelContent` component that switches on `PanelType` and renders the appropriate placeholder
- [x] 1.2 Implement `MetricContent` — large "--" value with a "No data" sub-label
- [x] 1.3 Implement `ChartContent` — 5 CSS bar columns of varying heights
- [x] 1.4 Implement `TextContent` — two faded placeholder text lines
- [x] 1.5 Implement `TableContent` — `<table>` with 2 header columns and 3 empty data rows

## 2. Styles

- [x] 2.1 Create `frontend/src/components/PanelContent.css` with styles for all four placeholders (theme-aware via CSS custom properties)

## 3. Wire into PanelGrid

- [x] 3.1 Import `PanelContent` in `PanelGrid.tsx`
- [x] 3.2 Replace the static `<p>` placeholder body with `<PanelContent type={panel.type} />`
- [x] 3.3 Add a type badge to the panel card footer (small `<span>` showing `panel.type`)

## 4. Tests

- [x] 4.1 Create `frontend/src/components/PanelContent.test.tsx` — assert each type renders its expected placeholder element (metric value, chart bars, text lines, table)
- [x] 4.2 Update existing `PanelGrid`/`App` tests that assert the old static body text — remove or replace those assertions

## 5. Verification

- [x] 5.1 Run `npm run lint` — zero warnings
- [x] 5.2 Run `npm run format:check` — clean
- [x] 5.3 Run `npm test` — all tests pass
- [x] 5.4 Run `npm run build` in `frontend/` — clean build
