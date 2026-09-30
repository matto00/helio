# HEL-1191: Move HEL-588 cross-filter onto the server-side equals filter

## Description

Leaf 4 of HEL-915. HEL-588's cross-filter still filters only the loaded rows in the browser (`useCrossFilteredPanelData.ts`), while HEL-1027 made table sort/filter server-side across the whole Output. A cross-filtered table ranks and counts the loaded window, so it disagrees with the server-filtered table next to it. Fix it using HEL-1188's `eq` operator.

Owner ruling that must NOT change (HEL-588 "Action in Inspect", 2026-09-25): a chart click opens Inspect only; Inspect has an explicit "Filter dashboard by X = Y" action, and only `PanelInspectView` dispatches `setCrossFilter`. This leaf changes how the filter is applied, not how it is triggered.

Owner ruling (2026-09-29, comment on HEL-1191): cross-filter state stays in Redux (`panelsSlice` `crossFilter`) only, NOT in the URL.

## Scope

* Apply the active cross-filter (dimension = value) to target panels as a server-side `eq` filter on their Output read, composed with per-panel control selections (HEL-1190) and the table's own filters, replacing client-side loaded-rows filtering.
* Persistence: decided by the owner ruling above (Redux only).
* Target panels whose Output lacks the column, or whose contract (HEL-1188) disallows `eq` on it, keep today's defined behaviour (state it).

## Acceptance criteria

* A cross-filtered table bound to an Output larger than one page shows the whole-Output match count, and `hasMore` describes the filtered set. Red-first against current main.
* The click -> Inspect -> action flow is byte-identical in trigger behaviour (test asserts only `PanelInspectView` dispatches `setCrossFilter`).
* Clearing the cross-filter restores the prior server state with no stale response winning.
* Verified on the desktop grid and the mobile stack.
* a11y (inline): the filtered state and its clearing are announced.
