## Standing Constraints

(none yet)

## 1. Frontend

- [x] 1.1 Add a pure helper building the note text per design D2 (loaded, total, narrowed) and verify by its unit test
- [x] 1.2 Compute the note in OutputPanelContent's chart branch, pass via ChartOutputPanel to a new ChartRenderer `truncationNote` prop rendered after the annotation (D1/D3/D4); verify by a render test
- [x] 1.3 Add `.chart-panel__truncation-note` (+ annotation-sibling rule) to `ui/PanelContent.css` per D3, existing tokens only; verify lint/format pass
- [x] 1.4 Thread `totalRowCount` into `PanelFullscreenOverlay` and `PanelDetailModal` per D5; verify by their render tests
- [x] 1.5 Confirm the public viewer path renders the note with no backend change; verify by a PublicDashboardViewerPage test

## 2. Tests

- [x] 2.1 Helper tests: "rows" vs "matching rows", digit grouping (1,234 — pin the locale explicitly or assert via Intl.NumberFormat so tests are locale-independent), singular-free wording; verify jest green
- [x] 2.2 Render tests: truncated shows note; complete (loaded == total) none; total unknown none; aggregated chart shows note
- [x] 2.2a Coexistence render test (D3a): annotation + truncation note + cross-filter disclosure all present, in that DOM order
- [x] 2.3 Pin overlay unchanged: truncated chart with `config.compare` shows note and no overlay; verify jest green
- [x] 2.4 Mutation check: break the show condition (e.g. drop `loadedCount < total`) and confirm a test goes red; record it
- [x] 2.5 Browser evidence: >200-row chart Output on an authenticated and a public dashboard, light and dark, plus fullscreen, plus one chart with annotation + truncation + cross-filter disclosure at default grid size; screenshots under evidencePath; record any dev-DB residue by exact id Include one narrow/compact panel.
- [x] 2.6 Run frontend gates (lint, typecheck, format:check, targeted jest) and confirm green
