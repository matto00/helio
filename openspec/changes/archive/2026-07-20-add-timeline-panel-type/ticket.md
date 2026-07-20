# HEL-317 — Add Timeline panel type

URL: https://linear.app/helioapp/issue/HEL-317/add-timeline-panel-type
Project: Helio v1.5 — Panel System v2
Priority: Medium

## Context

Helio's chart panels can plot a value *over time* (a line/bar of counts-per-hour), but there's no panel for a **chronological sequence of discrete events** — an "X happened at T₁, then Y at T₂" narrative. This is a distinct visualization: a vertical, ordered list of time-stamped events with short descriptions, not an axis of aggregated numbers.

**Motivating use case (helio-news):** the news aggregator (`helio-news`) reconstructs the actual chronology of a story from article text — e.g. "6:14am missile launch detected → 6:40am air-raid sirens → 9:00am one confirmed dead". Today that can only be rendered as prose in a markdown panel or faked as a bar chart of article-publish times, neither of which reads as a timeline. A first-class Timeline panel would let it (and any event-driven dashboard) show a real event sequence. Surfaced while building the aggregator's extractor pass.

## What

Add a `timeline` panel type that binds to a DataType producing rows of `(when, event)` — a timestamp/ordering column plus a short text label — and renders them as a vertical, chronological timeline (marker + connector + time + description per entry). Follows the v1.5 Panel System v2 pattern: the panel declares the *shape* it needs (an ordered event list), a smart pipeline produces that shape, and rendering scales with panel size like the other v1.5 types.

## Acceptance criteria

- [ ] `timeline` is selectable in the panel-creation type picker with an icon + one-line description (parity with other panel-type cards)
- [ ] The panel binds to a DataType whose rows expose a time/order field and a text/event field; field mapping is configurable in the panel config
- [ ] Rendered output lists events in chronological order as a vertical timeline (time + description per entry), visually distinct from a line/bar chart
- [ ] Rendering scales proportionally with panel dimensions and degrades gracefully for empty / single-row / long-description data
- [ ] (Stretch) Creatable/bindable through helio-mcp (`create_panel` / `bind_panel`) so agent-driven dashboards can use it
