## 1. Frontend

- [x] 1.1 Add a `containerRef` (`useRef<HTMLDivElement>(null)`) to `PanelList.tsx` and attach it to the `panel-list__zoom-container` div
- [x] 1.2 Add a `useEffect` in `PanelList.tsx` that attaches a non-passive `wheel` listener to `containerRef.current`
- [x] 1.3 Implement the wheel handler: guard on `ctrlKey || metaKey`; normalize `deltaY` for `deltaMode` (line=×24, page=×600); compute snapped delta (`Math.round((raw / 100) * 10) / 10`); call `handleZoomChange` with the snapped delta
- [x] 1.4 Return a cleanup function from the `useEffect` that calls `removeEventListener` to remove the wheel listener

## 2. Tests

- [x] 2.1 Add test: Ctrl+scroll down (`deltaY=100`, `ctrlKey=true`) decreases zoom by 0.1
- [x] 2.2 Add test: Ctrl+scroll up (`deltaY=-100`, `ctrlKey=true`) increases zoom by 0.1
- [x] 2.3 Add test: plain scroll (no modifier) does not change zoom level
- [x] 2.4 Add test: zoom is clamped at 0.5 minimum (Ctrl+scroll down at min)
- [x] 2.5 Add test: zoom is clamped at 2.0 maximum (Ctrl+scroll up at max)
- [x] 2.6 Add test: `deltaMode=1` (line) wheel event is normalized correctly (deltaY=1 line → 24px effective)
