## Context

`PanelList` currently renders a bare `<p className="panel-list__state">No panels yet.</p>` when `status === "succeeded" && items.length === 0`. There is no CTA — the only way to create a panel is via the small `+` button in the header. The change replaces this with a meaningful empty state block, inline in `PanelList.tsx`.

## Goals / Non-Goals

**Goals:**
- Replace the bare text with a structured empty state (icon + heading + subtext + CTA button)
- The CTA triggers the same inline create form as the `+` header button
- No loading flash: empty state is only shown after a successful load with zero items

**Non-Goals:**
- No new component files; markup stays inline in `PanelList.tsx`
- No panel type picker (deferred to HEL-23)
- No backend changes

## Decisions

**Inline markup vs. extracted component**
The empty state is a single-use element scoped entirely to `PanelList`. Extracting it to a separate file would add indirection with no reuse benefit. Markup stays inline.

**SVG icon inline vs. icon library**
The project has no icon library dependency. A small inline SVG grid outline avoids adding a dependency for one icon. The SVG can be replaced later when an icon system is adopted.

**CTA button action**
The button calls `setIsCreateMode(true)`, identical to the `+` header button. This reuses the existing inline create form without duplicating form logic or state.

**Disabled state**
The CTA mirrors the `+` button guard: disabled when `selectedDashboardId === null`. In practice this state is unreachable (an empty state only shows when a dashboard is selected and loaded), but the guard keeps behavior consistent.

## Risks / Trade-offs

- [Minimal] Inline SVG adds a few lines of markup — acceptable for a one-off icon with no dependency cost.
