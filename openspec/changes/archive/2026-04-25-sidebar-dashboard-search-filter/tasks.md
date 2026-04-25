## 1. Frontend

- [x] 1.1 Add `filterQuery` state (`useState<string>("")`) to `DashboardList.tsx`
- [x] 1.2 Derive the visible list: `.filter()` to include items matching the query or matching `selectedDashboardId`
- [x] 1.3 Render a filter input `<div>` with label above the `<ul>` (between header and list)
- [x] 1.4 Render a clear (✕) `<button>` inside the filter wrapper, hidden when `filterQuery` is empty
- [x] 1.5 Wire the clear button to reset `filterQuery` to `""`
- [x] 1.6 Apply `dashboard-list__item--outside-filter` CSS class to active dashboard items that appear only because they are active (not because they match)
- [x] 1.7 Add CSS rules to `DashboardList.css` for `.dashboard-list__filter`, `.dashboard-list__filter-input`, `.dashboard-list__filter-clear`, and `.dashboard-list__item--outside-filter`

## 2. Tests

- [x] 2.1 Add test: typing in filter input narrows the dashboard list (matching items shown, non-matching hidden)
- [x] 2.2 Add test: active dashboard remains visible even when filter does not match its name, with `--outside-filter` class applied
- [x] 2.3 Add test: clicking the clear button resets the filter and restores all items
- [x] 2.4 Add test: clear button is not rendered when filter is empty
