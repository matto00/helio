# HEL-1207: Provenance popover on output panels (desktop, mobile stack, fullscreen, detail modal, public)

## Description
Leaf 2 of HEL-916. Blocked by HEL-1206 (merged). The trust half: an exec opens any number and sees where it came from.

Scope: a provenance affordance on every output-bound panel kind (table, chart, metric, others): sources, pipeline and node path, last run (relative + absolute on hover/focus), row count, check summary, "Open pipeline" link (authenticated only). Host: new popover via usePortalPopover, NOT PanelInspectView; say where trigger lives and why. Every render path: desktop grid, mobile panel stack, fullscreen overlay, detail modal, public dashboards (anonymous/share-token get public variant; no pipeline link). Degraded states: never run, running, last run failed, no assertions defined, multi-source. Invalid data badge (PanelCard.tsx) links to/opens the popover's check section; avoid a second uncached assertion-status fetch per panel. Emit provenance_opened once telemetry exists; else leave a single typed hook point.

Owner rulings: public provenance shows source + pipeline NAMES, freshness, check counts; NO pipeline link, ids, config, error text or ownerId. Provenance is its own popover, not PanelInspectView.

## Acceptance criteria
- Opening provenance on a table, a chart and a metric panel shows the right chain. Verified live at desktop and phone widths, both themes, and as an anonymous viewer on a public dashboard.
- DESIGN.md binding (tokens, shared popover, touch targets per shared-popover-touch-targets). Visual cohesion compared against the running app.
- a11y: trigger keyboard-operable and labelled, focus trapped and returned, Escape closes, content announced.
- No extra request until the popover is opened (lazy), and a second open is served from cache.
