## Context

The panel creation modal (`PanelCreationModal.tsx`) has two steps: `type-select` and `name-entry`.
The `name-entry` step currently shows only a title input, a Back button, and a Create button.

`PanelContent.tsx` already renders all seven panel types in their unbound/placeholder states when
called with no `data`, `rawRows`, or `content` props. This makes it an ideal candidate for reuse
inside the modal preview — zero duplication of rendering logic.

## Goals / Non-Goals

**Goals:**
- Add a live preview pane to the `name-entry` step that shows the selected panel type rendering
- The preview title reflects the current value of the title input in real-time
- Reuse `PanelContent` directly — no new rendering logic

**Non-Goals:**
- Previewing data-bound states (data source is not selected at creation time)
- Adding new fields to the creation form (markdown body, image URL, etc.)
- Previewing the panel at multiple size breakpoints

## Decisions

### Decision 1: Reuse `PanelContent` directly in the modal

`PanelContent` already renders all seven types with correct placeholder states when data props are
omitted. Wrapping it in a preview shell inside `PanelCreationModal` is zero-risk and avoids any
render duplication. Alternative: a separate `PanelPreview` component that re-implements placeholders —
rejected as unnecessary indirection.

### Decision 2: Two-column layout on the `name-entry` step

The modal inner container gains a second column (form | preview) on the `name-entry` step. On
narrow viewports (< 600 px) it reverts to a single stacked column with the form above the preview.
This mirrors the approach used in `PanelDetailModal` which also uses a split layout.

The preview column is fixed-height (similar to a dashboard panel card, roughly 200 px) and
centered vertically inside a framed container with the current title shown at the top.

### Decision 3: Title in preview comes directly from `useState`

The `title` state already drives the input. Passing it to the preview shell as-is gives real-time
reflection without any additional state, debounce, or Redux involvement. A placeholder title
(e.g. "Untitled") is shown when the input is empty.

## Risks / Trade-offs

- [Risk] ChartPanel initialises an ECharts instance even in placeholder mode → Mitigation: The
  chart panel already renders an empty ECharts canvas in the grid; the additional instance in the
  modal is bounded to ~200 px and has no observable performance impact. The instance is destroyed
  on modal close as part of normal React unmount.
- [Risk] Modal becomes visually cluttered on small screens → Mitigation: the preview column is
  hidden on narrow viewports (< 600 px) or stacked below the form.

## Planner Notes

- No escalation required: purely frontend, no API changes, no new dependencies, narrow scope
- `PanelContent` export is already public (`export function PanelContent`) — no refactoring needed
- The preview wraps `PanelContent` inside a fixed-size frame styled to resemble a panel card
  (border, background, border-radius matching `--helio-panel-*` design tokens)
