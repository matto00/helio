# HEL-830 — Mechanical re-derivation (main @ 58855835)

Scanner: `spacing-scan.js` in this change dir (parses full declaration body to `;`, strips `var(--space-N)`, flags remaining literal spacing values > 4px that do not exactly match a `--space-*` token).

**Total: 102 off-scale literals across 18 files** (HEL-439 original: 119 across 20 files — see design.md for the reconciliation).

## By value

- `6px` × 39
- `10px` × 32
- `14px` × 12
- `5px` × 9
- `7px` × 8
- `60px` × 1
- `30px` × 1

## By file

### `features/dashboards/ui/DashboardAppearanceEditor.css` (2)

- L80 `gap: 6px;` — `6px`
- L86 `gap: 6px;` — `6px`

### `features/dashboards/ui/DashboardList.css` (3)

- L68 `padding: 0 30px 0 var(--space-2);` — `30px`
- L561 `padding: 2px 6px;` — `6px`
- L679 `padding: 2px 7px;` — `7px`

### `features/panels/ui/detailModal/PanelDetailModal.appearance.css` (5)

- L14 `gap: 6px;` — `6px`
- L20 `gap: 6px;` — `6px`
- L35 `gap: 6px;` — `6px`
- L53 `padding-top: 14px;` — `14px`
- L66 `gap: 6px;` — `6px`

### `features/panels/ui/detailModal/PanelDetailModal.binding.css` (8)

- L6 `gap: 14px;` — `14px`
- L128 `padding: 7px 10px;` — `7px`
- L128 `padding: 7px 10px;` — `10px`
- L174 `padding: 7px 10px;` — `7px`
- L174 `padding: 7px 10px;` — `10px`
- L192 `padding: 2px 6px;` — `6px`
- L265 `padding: 6px var(--space-2);` — `6px`
- L357 `padding: 2px 7px;` — `7px`

### `features/panels/ui/detailModal/PanelDetailModal.css` (2)

- L89 `padding: 10px var(--space-5);` — `10px`
- L104 `padding: 5px var(--space-3);` — `5px`

### `features/panels/ui/grid/PanelGrid.css` (1)

- L203 `padding: 2px 7px;` — `7px`

### `features/panels/ui/renderers/TimelineRenderer.css` (1)

- L40 `margin-top: 5px;` — `5px`

### `features/pipelines/ui/CreatePipelineModal.css` (1)

- L6 `gap: 14px;` — `14px`

### `features/pipelines/ui/OutputSchemaDisclosure.css` (1)

- L48 `gap: 5px;` — `5px`

### `features/pipelines/ui/OutputsRail.css` (1)

- L18 `padding: 0 14px;` — `14px`

### `features/pipelines/ui/PipelineDetailHeader.css` (4)

- L25 `padding: var(--space-2) 14px;` — `14px`
- L106 `padding: 2px 6px;` — `6px`
- L350 `padding: 2px 6px;` — `6px`
- L369 `padding: 0 14px;` — `14px`

### `features/pipelines/ui/PipelineDetailPage.css` (50)

- L19 `padding: 6px var(--space-5) 0;` — `6px`
- L130 `padding: 60px var(--space-5);` — `60px`
- L244 `padding: 7px 10px;` — `7px`
- L244 `padding: 7px 10px;` — `10px`
- L348 `padding: 10px 14px;` — `10px`
- L348 `padding: 10px 14px;` — `14px`
- L462 `margin: var(--space-2) 0 0 14px;` — `14px`
- L694 `padding: var(--space-3) 14px;` — `14px`
- L698 `gap: 10px;` — `10px`
- L710 `gap: 6px;` — `6px`
- L716 `padding: 2px 7px;` — `7px`
- L751 `padding: 4px 10px;` — `10px`
- L765 `padding: 4px 10px;` — `10px`
- L781 `padding-top: 10px;` — `10px`
- L795 `padding: 2px 7px;` — `7px`
- L810 `padding: 10px 0;` — `10px`
- L840 `padding: 10px var(--space-5);` — `10px`
- L846 `gap: 10px;` — `10px`
- L883 `padding: 2px 6px;` — `6px`
- L901 `gap: 5px;` — `5px`
- L908 `padding: 1px 6px;` — `6px`
- L923 `gap: 10px;` — `10px`
- L948 `gap: 10px;` — `10px`
- L975 `gap: 6px;` — `6px`
- L991 `padding: 1px 6px;` — `6px`
- L1050 `gap: 6px;` — `6px`
- L1051 `padding: 4px 10px;` — `10px`
- L1114 `padding: 0 14px;` — `14px`
- L1175 `gap: 6px;` — `6px`
- L1231 `padding: 0 14px;` — `14px`
- L1305 `padding: 4px 6px;` — `6px`
- L1330 `gap: 10px;` — `10px`
- L1337 `gap: 6px;` — `6px`
- L1384 `gap: 6px;` — `6px`
- L1393 `padding: 5px 10px;` — `5px`
- L1393 `padding: 5px 10px;` — `10px`
- L1422 `gap: 10px;` — `10px`
- L1437 `gap: 6px;` — `6px`
- L1445 `gap: 6px;` — `6px`
- L1458 `gap: 6px;` — `6px`
- L1460 `padding: 0 10px;` — `10px`
- L1484 `padding: 5px 10px;` — `5px`
- L1484 `padding: 5px 10px;` — `10px`
- L1521 `gap: 6px;` — `6px`
- L1548 `gap: 6px;` — `6px`
- L1555 `gap: 6px;` — `6px`
- L1570 `gap: 10px;` — `10px`
- L1619 `padding: 6px var(--space-2);` — `6px`
- L1646 `padding: 6px var(--space-2);` — `6px`
- L1654 `padding: 6px var(--space-2);` — `6px`

### `features/pipelines/ui/PipelinesPage.css` (3)

- L29 `padding: var(--space-2) 10px;` — `10px`
- L88 `gap: 5px;` — `5px`
- L89 `padding: 4px 10px;` — `10px`

### `features/pipelines/ui/RunHistoryModal.css` (4)

- L6 `gap: 6px;` — `6px`
- L10 `padding: 10px var(--space-3);` — `10px`
- L31 `row-gap: 6px;` — `6px`
- L90 `padding: 10px;` — `10px`

### `features/settings/ui/AgentMemoryList.css` (1)

- L65 `padding: var(--space-2) 10px;` — `10px`

### `features/sources/ui/AddSourceModal.css` (5)

- L6 `gap: 14px;` — `14px`
- L46 `padding: 5px 0;` — `5px`
- L53 `gap: 6px;` — `6px`
- L133 `padding: 6px var(--space-2);` — `6px`
- L158 `padding: 4px 6px;` — `6px`

### `features/sources/ui/SourceDetailPanel.css` (9)

- L20 `gap: 10px;` — `10px`
- L104 `gap: 6px;` — `6px`
- L112 `padding: 0 10px;` — `10px`
- L155 `margin: 0 0 6px;` — `6px`
- L182 `padding: 6px 10px;` — `6px`
- L182 `padding: 6px 10px;` — `10px`
- L187 `padding: 5px 10px;` — `5px`
- L187 `padding: 5px 10px;` — `10px`
- L203 `padding: 10px var(--space-3);` — `10px`

### `features/sources/ui/SourceListTable.css` (1)

- L28 `padding: var(--space-2) 10px;` — `10px`

