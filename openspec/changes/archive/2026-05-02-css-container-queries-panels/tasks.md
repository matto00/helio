## 1. Frontend — Container Context

- [x] 1.1 Add `container-type: size` and `container-name: panel-card` to `.panel-grid-card` in `PanelGrid.css`

## 2. Frontend — Card-Level Container Query Rules

- [x] 2.1 Add `@container panel-card (max-width: 219px)` block to `PanelGrid.css` — set padding `10px`, gap `8px`, title `0.85rem`
- [x] 2.2 Add `@container panel-card (max-height: 179px)` block to `PanelGrid.css` — set padding `10px`, gap `8px`, title `0.85rem`
- [x] 2.3 Add `@container panel-card (min-width: 420px) and (min-height: 280px)` block to `PanelGrid.css` — set padding `20px`, title `1.1rem`

## 3. Frontend — Panel Content Container Query Rules

- [x] 3.1 Add `@container panel-card (max-height: 179px)` block to `PanelContent.css` — metric value `1.25rem`
- [x] 3.2 Add `@container panel-card (min-height: 280px)` block to `PanelContent.css` — metric value `2.5rem`
- [x] 3.3 Add `@container panel-card (max-height: 179px)` block to `PanelContent.css` — table cell padding `2px 6px`, cell height `14px`
- [x] 3.4 Add `@container panel-card (max-height: 179px)` block to `PanelContent.css` — text live font-size `0.78rem`

## 4. Tests

- [x] 4.1 Verify `npm run build` completes with no CSS errors and no TypeScript errors
- [x] 4.2 Verify `npm run lint` passes with zero warnings
- [x] 4.3 Verify `npm test` passes (no regressions from CSS changes)
