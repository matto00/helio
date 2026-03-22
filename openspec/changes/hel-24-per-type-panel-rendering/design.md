## Context

`PanelGrid.tsx` renders each panel card with a hardcoded placeholder `<p>` body. The card structure is: top bar (title + actions) → body → footer. We need the body to vary by `panel.type`.

## Goals / Non-Goals

**Goals:**
- Replace the static body with type-specific placeholder content
- Each placeholder is visually distinct and hints at the panel's purpose
- Zero-data graceful: all placeholders work with no real data at all

**Non-Goals:**
- Real data rendering (future data ingestion tickets)
- Animations or skeleton loading states
- Responsive per-type layouts (placeholders use simple fixed structure)

## Decisions

**Single `PanelContent.tsx` file with a switch over four inline components**
The four placeholder components are small (10–20 lines each). Splitting each into its own file would add navigation overhead for no reuse benefit. One file with a default export `PanelContent` that takes `{ type: PanelType }` and switches cleanly.

**CSS-only placeholders (no SVG, no third-party chart lib)**
This is a placeholder stage. Pure CSS bar columns (height-varied `<span>` elements) for Chart, a `<table>` element with empty cells for Table, faded `<p>` lines for Text, and a large styled `<span>` for Metric. No dependencies introduced.

**Remove the static footer copy text from `PanelGrid`**
The existing "Starter grid placement is live..." placeholder copy lives in `PanelGrid`. It belongs conceptually to the panel body, so it's removed and replaced by `PanelContent`. The last-updated footer is kept.

**Theme-aware via CSS custom properties**
Placeholder elements use `--app-text-muted`, `--app-border-subtle`, and `--app-accent-surface` (already defined in the design system) so they automatically respond to light/dark theme.

## Risks / Trade-offs

- [Type-switch diverges from panel data] If a new `PanelType` value is added in the future without updating the switch, it will fall through to a default (Metric). Mitigation: the switch includes an exhaustive default that renders the Metric placeholder — a safe fallback, not a blank.
