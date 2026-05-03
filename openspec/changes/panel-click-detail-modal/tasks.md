## 1. Frontend

- [x] 1.1 Add `mousedownPos` ref to `PanelGrid` to record pointer coordinates on `mousedown` of each panel card
- [x] 1.2 Add `handlePanelCardMouseDown` handler that stores `{x: clientX, y: clientY}` in the ref
- [x] 1.3 Add `handlePanelCardClick` handler that: (a) skips if displacement > 5px, (b) skips if event target is or is inside a button/input/a/.react-resizable-handle, (c) calls `setDetailPanelId(panel.id)`
- [x] 1.4 Attach `onMouseDown` and `onClick` handlers to each `<article class="panel-grid-card">` element in the panels map
- [x] 1.5 Add `cursor: pointer` style to `.panel-grid-card` in `PanelGrid.css` to communicate clickability

## 2. Tests

- [x] 2.1 Add Jest/RTL tests for `PanelGrid`: clicking panel body opens detail modal
- [x] 2.2 Add test: simulated drag (mousedown then click with large displacement) does NOT open modal
- [x] 2.3 Add test: clicking the drag handle button does NOT open modal
- [x] 2.4 Add test: clicking the actions menu trigger does NOT open modal
