## Context

`DashboardList.tsx` renders the full sidebar dashboard list. It already uses multiple `useState` hooks for create mode, rename, delete confirm, etc. The `items` array comes from `useAppSelector` on `state.dashboards`. The component renders a `<ul>` of all items unconditionally.

## Goals / Non-Goals

**Goals:**
- Add a text filter input above the `<ul>` in `DashboardList.tsx`
- Derive a filtered list via a local `useMemo` (or inline `.filter()`) — no Redux state
- Always render the active dashboard in the list even if filtered out; apply a CSS modifier class to indicate it is outside the filter
- Render a clear (✕) button inside the filter input when filter text is non-empty

**Non-Goals:**
- Redux state for the filter string
- Server-side or API-driven search
- Fuzzy or advanced matching
- Filtering by anything other than dashboard name

## Decisions

**Local state only** — `useState<string>("")` for the filter query. The list is derived via `.filter()` in render: `items.filter(d => d.name.toLowerCase().includes(query.toLowerCase()) || d.id === selectedDashboardId)`. Active dashboard is always included; a CSS class `dashboard-list__item--outside-filter` marks it when it would otherwise be hidden.

**Placement** — Filter input goes between the `<header>` and the create `<form>` (or the `<ul>` when not in create mode), so it is always visible rather than conditionally shown after N dashboards. This avoids a threshold magic number and matches the scope wording "appears when there are more than N dashboards, or always."

**Clear button** — Rendered as an absolutely-positioned `<button>` inside a relative wrapper `<div>` around the input (same pattern used elsewhere in the codebase for composite inputs). Hidden via CSS when filter is empty.

**No new component** — Filter markup stays in `DashboardList.tsx` to avoid prop-threading. A `DashboardFilter` sub-component is not warranted for this scope.

**CSS** — New rules added to `DashboardList.css`. The `--outside-filter` modifier dims the item (reduced opacity) and adds a small "active" badge so the user understands why it appears.

## Risks / Trade-offs

- [Large list performance] `.filter()` on every render is O(n) but negligible for realistic dashboard counts (< 1000). No memoisation needed. → Acceptable.
- [Active dashboard visibility] Always including the active dashboard could be surprising if the user expects the filter to be strict. → Mitigated by the visual indicator and the ticket requirement.

## Planner Notes

- Self-approved: no new dependencies, no API changes, frontend-only, one component modified.
- The "outside filter" visual treatment is intentionally simple (opacity + badge text). Detailed styling is left to the executor per existing CSS conventions in `DashboardList.css`.
