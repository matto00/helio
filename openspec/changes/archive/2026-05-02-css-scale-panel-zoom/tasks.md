## 1. Frontend — CSS

- [x] 1.1 Add `overflow: hidden` to `.panel-list` rule in `PanelList.css`
- [x] 1.2 Add `.panel-list__zoom-container` CSS rule (no visual styling needed — the container is purely structural; overflow and dimensions come from inline styles)
- [x] 1.3 Add `.panel-list__zoom-controls` CSS rule (flex layout matching header-actions pattern)
- [x] 1.4 Add `.panel-list__zoom-button` CSS rule (style consistent with `.panel-list__add` button)
- [x] 1.5 Add `.panel-list__zoom-level` CSS rule (style consistent with `.panel-list__count` badge)
- [x] 1.6 Add `.panel-list__zoom-reset` CSS rule (style consistent with `.panel-list__add` button)

## 2. Tests

- [x] 2.1 Add test in `PanelList.test.tsx`: when panels exist and zoom is 1.5 (from user preferences), the `.panel-list__zoom-container` div has `transform: scale(1.5)`, `transformOrigin: top left`, `width: ~66.67%`, `height: ~66.67%`
- [x] 2.2 Add test: zoom level is restored from `currentUser.preferences.zoomLevels` when a dashboard is selected
