## 1. Frontend — CSS cleanup and normalization

- [x] 1.1 Remove the dead `.dashboard-list__collapse` block (lines ~30–58) from `DashboardList.css`
- [x] 1.2 Audit `DashboardList.css` filter input rules and set height to 28 px and font-size to `var(--text-xs)`
- [x] 1.3 Audit `PanelList.css` for any filter/search input and normalize height to 28 px, font-size to `var(--text-xs)` if present
- [x] 1.4 Audit `TypeRegistryBrowser.css` for filter/search input and normalize height to 28 px, font-size to `var(--text-xs)` if present
- [x] 1.5 Verify DashboardList header action buttons are 24 × 24 px; fix if not
- [x] 1.6 Verify PanelList card action buttons (three-dot menu) are 24 × 24 px; fix if not
- [x] 1.7 Verify TypeRegistry action buttons are 24 × 24 px; fix if not
- [x] 1.8 Check `.app-sidebar__nav-link` font-size in `App.css`; replace any raw px/rem value with `var(--text-xs)` or appropriate token
- [x] 1.9 Check eyebrow labels in the sidebar; replace raw font-size values with `var(--eyebrow-size)` or appropriate token

## 2. Tests

- [x] 2.1 Run `npm run lint` and confirm zero warnings/errors
- [x] 2.2 Run `npm test` and confirm all tests pass
- [x] 2.3 Run `npm run format:check` and confirm no formatting issues
