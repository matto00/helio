## 1. Frontend — Layout restructure

- [x] 1.1 Add `position: relative` to `.panel-list` in `PanelList.css`
- [x] 1.2 Remove zoom controls block from header (`panel-list__zoom-controls`) in `PanelList.tsx`
- [x] 1.3 Simplify `panel-list__header-actions` to flex-end (single group: count + add)
- [x] 1.4 Add floating `panel-list__zoom-widget` div (conditionally rendered when dashboard selected)
      with `role="group"` and `aria-label="Zoom controls"`, containing zoom in/out/reset/level

## 2. Frontend — CSS for zoom widget

- [x] 2.1 Remove `.panel-list__zoom-controls` rule (no longer used in header)
- [x] 2.2 Add `.panel-list__zoom-widget` rule: `position: absolute; bottom: 20px; right: 20px;
      z-index: 10; display: inline-flex; align-items: center; gap: 4px;`
- [x] 2.3 Migrate zoom button and zoom-level styles from `.panel-list__zoom-button` /
      `.panel-list__zoom-reset` / `.panel-list__zoom-level` to work within the widget
      (classes can stay the same; no style changes needed — just move the HTML)

## 3. Frontend — Header cleanup CSS

- [x] 3.1 Update `panel-list__header-actions` to `justify-content: flex-end`
- [x] 3.2 Verify `panel-list__panel-actions` gap/alignment still looks correct without zoom sibling

## 4. Tests

- [ ] 4.1 Run `npm test -- --testPathPattern=PanelList` and confirm all existing zoom tests pass
      (aria-labels unchanged; widget position is not asserted in existing tests)
- [ ] 4.2 Run full test suite `npm test` and confirm no regressions
- [ ] 4.3 Run `npm run lint` and `npm run format:check` — fix any issues
