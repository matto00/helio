## 1. Frontend — CSS

- [x] 1.1 Update `.panel-content--table` in `PanelContent.css`: add `flex-direction: column; justify-content: flex-start; align-items: stretch; overflow-y: auto; min-height: 0`
- [x] 1.2 Add `height: 100%; min-height: min-content` to `.panel-content__table` so short tables fill available height without dead space

## 2. Tests

- [x] 2.1 Add test to `PanelContent.test.tsx`: `TableContent` with data rows renders `.panel-content--table` container
- [x] 2.2 Add test: `TableContent` with no data renders the placeholder table inside `.panel-content--table`
- [x] 2.3 Add test: `TableContent` renders correct number of `<tr>` rows for given `rawRows`
- [x] 2.4 Add test: `TableContent` renders column headers from `headers` prop when provided
