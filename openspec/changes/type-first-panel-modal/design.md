## Context

Panel creation currently lives entirely in `PanelList.tsx` as an inline form toggled by `isCreateMode`. The form contains a title `<input>` and a `<fieldset>` of radio buttons for type selection side by side. There is no separate type-selection step — users arrive at the title field immediately with the type selector below it.

The codebase already has a working two-step modal precedent in `AddSourceModal.tsx` using `<dialog>` + `dialogRef.current?.showModal()`. Overlay lifecycle (Escape to close, single-active-overlay enforcement) is handled by `OverlayProvider` / `useOverlay`.

## Goals / Non-Goals

**Goals:**
- Replace the inline `isCreateMode` form with a `<dialog>`-based `PanelCreationModal`
- Step 1: type picker only — 7 type cards (metric, chart, text, table, markdown, image, divider)
- Step 2: title input + create button
- Reuse the existing `OverlayProvider` / `useOverlay` for open/close/Escape handling
- Keep the Redux dispatch (`createPanel`) and post-create refresh logic unchanged
- Keep the empty-state CTA in `PanelList` wired to the same modal

**Non-Goals:**
- Backend changes of any kind
- Type-specific config beyond a title field
- Animated step transitions

## Decisions

**D1: Use native `<dialog>` + `useOverlay`, matching `AddSourceModal`**
`AddSourceModal` already establishes this pattern (refs, `showModal()`, `onClose` prop).
Using the same approach keeps CSS class naming consistent and avoids introducing a third overlay mechanism.

**D2: Two-step state machine — `"type-select" | "name-entry"` — inside the modal**
The modal owns its own step state (local `useState`). No Redux slice changes are needed. Reset on close mirrors `AddSourceModal`'s approach of re-mounting via conditional render in the parent.

**D3: Parent (`PanelList`) mounts/unmounts the modal via `isModalOpen` boolean**
`AddSourceModal` is rendered conditionally by its parent (`SourcesPage`). `PanelList` will do the same: `{isModalOpen && <PanelCreationModal ... />}`. This auto-resets all modal-local state on close without needing explicit reset logic.

**D4: Type cards (grid of buttons), not radio inputs**
Radio inputs are accessible but harder to style as large, tappable cards. Cards with `role="radio"` and `aria-checked` on each button give the same a11y semantics with better visual affordance. Each card shows the type label and a small icon (SVG or text character).

**D5: Remove inline `isCreateMode` form from `PanelList`**
The ticket says "replaces the existing create flow end-to-end". The inline form, its state variables (`title`, `panelType`, `isCreating`, `createError`, `isCreateMode`), and the `PANEL_TYPES` constant inside `PanelList` are all removed. Panel type list moves to `PanelCreationModal`.

## Risks / Trade-offs

[Test surface increases] Creating `PanelCreationModal` as a separate component makes it easier to unit-test step transitions independently — net positive.
[Empty-state CTA] The CTA button in the empty state currently calls `setIsCreateMode(true)`. It will instead call `openModal()` from `useOverlay`. Low risk but requires reading the overlay hook from the parent. Mitigation: lift `useOverlay` to `PanelList` and thread `open` down as a prop or call it directly.

## Planner Notes

Self-approved. This is a contained frontend refactor with no backend or API contract changes. No new external dependencies introduced.
