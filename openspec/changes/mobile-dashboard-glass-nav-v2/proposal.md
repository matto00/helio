## Why

On a phone, dashboard text sits ~57px from each screen edge (five stacked paddings), switching dashboards takes a
sheet round-trip, the zoom widget floats over content between 431px and 768px, and the glass nav has 6–7 icon-only
tabs that overflow at 320px for owners. DESIGN.md v3 §12 sets the target; HEL-1583 implements it.

## What Changes

- **Phase A (independent of the pending tab-set ruling):**
  - Phone gutters: content 12px from the screen edge, ~10px between stacked panels, ~14px panel padding, no nested
    markdown padding; text in a markdown panel starts <= 28px from the edge at 375px.
  - A horizontally scrollable dashboard chip row under the phone command bar on the dashboard view: one tap switches
    dashboards, the active chip is filled and scrolled into view on load.
  - The zoom widget is not rendered over content on the phone shell (<= 768px).
  - Bottom clearance for the glass nav kept for every stacked panel and the chip row.
- **Phase B (after the owner answers the pending escalation):**
  - Glass nav v2: the owner-chosen five tabs; Connectors reachable through a Data tab (Sources | Connectors); Usage
    reachable; the active tab expands into a labelled pill with a tokenised width transition; HEL-774 floors and the
    label's 4.5:1 floor re-measured from rendered pixels in both themes.
  - The mono "refreshed 9h ago" header line, sequenced per the pending ruling (HEL-1576's `useDashboardMeta`).

## Capabilities

### New Capabilities
- `mobile-dashboard-chips`: phone dashboard chip row (one-tap switch, active chip filled and in view).

### Modified Capabilities
- `mobile-viewer-stack`: phone stack gutters and markdown inset.
- `dashboard-chrome-zoom-widget`: the widget is hidden across the whole phone shell, not only below 430px.
- `mobile-bottom-nav`: (Phase B) final tab set, expanding labelled active tab.

## Impact

Frontend only: `PanelList`, `MobilePanelStack`, `PanelGrid.css`, `MarkdownPanel.css`, `mobilePanelHeights`,
`PanelList` (chip row mount, zoom gating), `BottomNav` + `navDestinations`/`sections` (Phase B), DESIGN.md §12/§3
carve-out text (Phase B), unit + e2e tests (hel1574 shell spec pins 6 tabs). No backend, schema or migration change.

## Non-goals

- Swipe between dashboards (HEL-556 stretch) — not built.
- Desktop grid gutters/meta row (HEL-1576), dashboard tabs (HEL-1575), the Home page (HEL-1578).
- A new pinned-dashboards preference; chips use existing recent-visit history and dashboard order.
- The board's serif title (sans only).
