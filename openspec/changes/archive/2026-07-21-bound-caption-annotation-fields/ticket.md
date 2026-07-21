# HEL-323 — DataType-field-bound captions/annotations on image and chart panels

**Linear:** https://linear.app/helioapp/issue/HEL-323
**Priority:** Low
**Project:** Helio v1.5 — Panel System v2
**Related:** HEL-318 (PR #254, static captions/annotations shipped)

## Context

Follow-up from HEL-318 (Support captions / annotations on image and chart panels, PR #254),
which shipped **static free-text** captions (image) and annotations (chart) only. The
final-gate skeptic flagged **DataType-field-bound** captions as out of scope for that ticket:
sourcing the caption/annotation text dynamically from a bound DataType field rather than a
fixed string.

The original HEL-318 phrasing treated bound sourcing as a "may," and it was deferred for a
concrete reason: **image panels have no binding infrastructure today** (they're unbound
`{ imageUrl, imageFit }` + now a static `caption`). Chart panels are bound, so the
chart-`annotation` case is more tractable than the image-`caption` case.

## Task

Allow a panel's caption/annotation to optionally be sourced from a bound DataType field
instead of static text:

- **Chart annotation** (lower-hanging — charts are already bound): allow the `annotation` to
  reference a field from the chart's bound DataType (e.g. a single-row value, or a designated
  annotation column).
- **Image caption** (needs groundwork): scope/spike what minimal binding infra an image panel
  would need to source a caption from a DataType field, or explicitly defer the image side if
  the infra cost is high.
- Keep static text working as-is (the source is a choice: static vs. bound field).

## Acceptance criteria

1. A chart panel can render an annotation sourced from a bound DataType field, updating when
   the data changes.
2. Static captions/annotations continue to work unchanged (backward compatible).
3. Image-caption binding is either implemented or explicitly scoped out with a documented
   reason.
4. Gates green; round-trips create/PATCH/read.

## Notes

Deferred from HEL-318 per scope. Low priority — static text covers the immediate helio-news
motivating use case; this is the richer follow-on.
