# HEL-54: Search/filter in dashboard sidebar

## Summary

As users accumulate more dashboards, the sidebar list becomes hard to scan. Add a text filter input to the sidebar so users can quickly find a dashboard by name.

## Scope

* Text input at the top of the dashboard list (appears when there are more than N dashboards, or always)
* Filters the visible list in real time as the user types (client-side, no API call)
* Case-insensitive substring match on dashboard name
* If the active dashboard is filtered out, it remains accessible but visually indicated as outside the current filter
* Clear button (✕) to reset the filter

## Acceptance criteria

* Typing in the filter input narrows the dashboard list in real time
* Clearing the input restores the full list
* The active dashboard is always reachable regardless of the filter state
