# HEL-318 — Support captions / free-text annotations on image and chart panels

Linear: https://linear.app/helioapp/issue/HEL-318
Project: Helio v1.5 — Panel System v2
Priority: Medium

## Context

Image panels today are unbound `{ imageUrl, imageFit }` with no text field, and chart panels have a title but no free-text annotation. That means any short piece of text a dashboard wants to *attach to a visual* — a photo caption, a pull-quote over a chart, a source credit — has to become its own separate panel, which wastes grid space and reads as padding.

**Motivating use case (helio-news):** the news aggregator wants to surface a single consequential quote or one-line takeaway tied to a story's hero image or its data chart, rather than spending a whole markdown panel on one sentence. There is currently no way to render "text belonging to this visual." Related ticket HEL-317 (Add Timeline panel type, also surfaced from helio-news).

## What

Add an optional caption / annotation text field to image and chart panels:

* **Image panel:** optional `caption` string, rendered as an overlay or a strip beneath the image. Supports plain text (Markdown inline formatting a stretch).
* **Chart panel:** optional `annotation` / subtitle string rendered under the chart title or as a footnote (e.g. a source credit or one-line takeaway).
* Caption text may be static (typed in config) or, consistent with the v1.5 direction, sourced from a bound DataType field.

## Acceptance criteria

- [ ] Image panels accept an optional caption that renders with the image (overlay or caption strip) and is empty/hidden when unset
- [ ] Chart panels accept an optional annotation/subtitle that renders with the chart and is hidden when unset
- [ ] Caption/annotation text scales with the panel and truncates or wraps gracefully rather than overflowing
- [ ] The field round-trips through the panel API (create/update + read) and is covered by the panel config UI
- [ ] (Stretch) Settable via helio-mcp so agent-built dashboards can attach captions/annotations
