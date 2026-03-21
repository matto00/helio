## 1. Component Markup

- [x] 1.1 Replace the `<p className="panel-list__state">No panels yet.</p>` block in `PanelList.tsx` with a structured empty state block containing an inline SVG grid icon, heading "No panels yet", subtext "Add a panel to start building your dashboard", and an "Add panel" button that calls `setIsCreateMode(true)`
- [x] 1.2 Ensure the "Add panel" button in the empty state is disabled when `selectedDashboardId === null`

## 2. Styling

- [x] 2.1 Add `.panel-list__empty-state` styles in `PanelList.css`: centered flex column layout, padding, border, and border-radius matching the existing surface style
- [x] 2.2 Add styles for the icon, heading, subtext, and CTA button within the empty state block

## 3. Tests

- [x] 3.1 Update the existing "renders the empty-state message when a selected dashboard has no panels" test in `PanelList.test.tsx` to assert on the new heading text and "Add panel" button presence
- [x] 3.2 Add a test that clicking the "Add panel" button in the empty state opens the inline create form

## 4. Verification

- [x] 4.1 Run `npm run lint` and `npm run format:check` — no errors
- [x] 4.2 Run `npm test -- --testPathPattern=PanelList` — all tests pass
- [x] 4.3 Run `npm run build` — clean build
