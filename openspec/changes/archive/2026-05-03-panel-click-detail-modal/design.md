## Context

`PanelGrid.tsx` renders each panel as an `<article class="panel-grid-card">` inside a react-grid-layout `<Responsive>` grid. The grid fires `onDragStop` / `onResizeStop` at interaction end, but the underlying DOM also fires a `click` event on the dragged/resized element after `mouseup` — as long as the pointer hasn't moved significantly. There is no built-in react-grid-layout prop to suppress post-drag clicks.

The detail modal is already rendered conditionally by `PanelGrid` using local state (`detailPanelId`). Opening it from the "Customize" actions-menu item calls `setDetailPanelId(panel.id)`. The drag handle is a `<button class="panel-grid-card__handle">` and the resize handle is injected by react-grid-layout as `.react-resizable-handle`.

## Goals / Non-Goals

**Goals:**
- Clicking the panel body (not on interactive controls) opens the detail modal.
- Drags and resizes never open the modal.
- The fix is contained to `PanelGrid.tsx` (no new files required).

**Non-Goals:**
- No new Redux state — `detailPanelId` local state in `PanelGrid` is sufficient.
- No CSS changes needed.
- No backend changes.

## Decisions

**Decision: mousedown displacement threshold on the `<article>` element**

On `mousedown` record the pointer coordinates. On `click` (which fires after `mouseup` on the same target), check the displacement. If `|dx| + |dy| > 5px`, suppress the open — this was a drag. Otherwise open the modal.

Rationale: React Grid Layout fires `click` on the panel element after every interaction including drag/resize. The browser fires `click` only when `mouseup` lands on the same element as `mousedown` AND no text was selected. Checking displacement in the `click` handler itself (comparing against the recorded `mousedown` position) is the simplest, most reliable method that does not require hooking into RGL lifecycle callbacks.

Alternative considered — intercept `onDragStart`/`onResizeStart` to set a `isDragging` ref: works, but the RGL callbacks fire on the grid level, not the panel level, requiring the panel id to be cross-referenced. The displacement approach is self-contained per card.

**Decision: Exclude interactive descendant clicks via `event.target` check**

Before opening the modal, confirm `event.target` (or its closest ancestor within the article) is not a `button`, `input`, `a`, or `.react-resizable-handle`. This prevents the rename input, actions menu trigger, drag-handle button, and delete confirm buttons from spuriously opening the modal.

Alternative considered — stopPropagation on each interactive child: fragile; requires touching every child component.

**Decision: The click zone is the entire `<article>` minus the `__top` bar interactive elements**

The top bar already contains all interactive controls (title, actions menu, drag handle). Clicks on `PanelCardBody` and `panel-grid-card__footer` are clear intent to open details. We check target exclusions rather than defining a sub-zone, so the implementation is forward-compatible with any new interactive children.

## Risks / Trade-offs

- [Risk] Accidental opens on very short drags → Mitigation: threshold of 5px; empirically sufficient for intentional drag distances.
- [Risk] Touch events — `click` fires after touch but `mousedown` may not → Mitigation: out of scope; touch layout editing is not a current use case.

## Planner Notes

Self-approved: purely additive UI interaction, no API surface, no new deps, no schema changes.
