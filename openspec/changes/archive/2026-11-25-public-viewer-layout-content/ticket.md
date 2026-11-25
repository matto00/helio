# HEL-1587: Public share viewer ignores the dashboard layout and doesn't render markdown or image panels

## Description

Found while capturing the owner's real boards for the landing page (HEL-1562) through public share links. On production, 2026-10-13, opening `/dashboards/:id/panels?token=…` for "News Overview" and the Helio development board showed that the public viewer (`PublicDashboardViewerPage`) differs from the signed-in dashboard in two ways:

1. **No layout.** Every panel renders full width in one stacked column (about 2,600 px tall for News Overview at 1440 px wide). The dashboard's stored `layout` breakpoints are ignored.
2. **Content panels don't render.** Markdown and image panels show only their title and the literal type name ("Markdown", "Image"), not the content or image. The data is available: the public `GET /api/dashboards/:id/panels` response carries `config.content` for markdown and `config.imageUrl`/`caption`/`imageFit` for images.

So a shared news board shows its charts but none of its stories, and every shared dashboard loses its arrangement. Output panels (charts, metrics with comparisons, tables with conditional formats, reference lines) render correctly.

## Acceptance criteria

- [ ] The public viewer lays panels out from the dashboard's stored layout at each breakpoint, matching the signed-in grid (read-only: no drag, resize or edit affordances). Phones keep the existing phone stack.
- [ ] Markdown, text, image and divider panels render their content in the public viewer, using the same renderers as the signed-in app.
- [ ] Image URLs and markdown are rendered with the same sanitising and URL rules as the signed-in app (no new XSS or mixed-content surface), covered by tests.
- [ ] A public-view e2e or component test covers a dashboard with an output panel, a markdown panel and an image panel in a two-column layout.

## Driver additions (2026-11-25)

- Read-only grid: no drag, resize, edit affordances, no layout save, no `layout/repair` call.
- Tests include a hostile markdown / image-URL case.
- Public-view e2e: output + markdown + image panel in a two-column layout, both themes, at 375 px and desktop.
- The public panel-list response must expose exactly what the renderers need and nothing more (HEL-1248 owner-id guard). Widening the public API is escalated before it is done.

origin_kind: followup
origin_ticket: HEL-1562
