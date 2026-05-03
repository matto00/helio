## Context

HEL-168 shipped the type-first panel creation modal with a basic card grid (icon + label). The cards immediately advance to the name-entry step on click, with no persistent selected state on the type-select step.

This change enriches the visual card component by adding a one-line description per panel type and introducing a proper selected/highlighted card state. It is frontend-only with no API or schema changes.

Current state:
- `PanelCreationModal.tsx` defines `PANEL_TYPES` as `{ value, label, icon }[]`
- Cards are plain `<button>` elements that call `handleTypeSelect(type)` on click, immediately advancing to step 2
- No selected-state CSS class exists on the type-select step

## Goals / Non-Goals

**Goals:**
- Add `description` field to each panel type entry in `PANEL_TYPES`
- Render description text on each type card
- Introduce a `--selected` modifier CSS class on the currently-focused/hovered card that applies the accent border/background highlight
- Keep the card auto-advance behavior (click → immediately go to name-entry): the "selected" state is a brief visual affordance on focus/hover rather than a two-step selection

**Non-Goals:**
- Changing the two-step modal flow or introducing a separate "Continue" button
- Any backend or API changes
- Modifying which panel types are available

## Decisions

### Decision: Description as static constant, not fetched from backend

**Why**: Panel type descriptions are purely cosmetic metadata for the creation UI; they are not part of the panel resource model and require no API call. A `PANEL_TYPES` constant in the component file is the existing pattern (icon and label are already there).

**Alternative considered**: A separate `panelTypeRegistry.ts` file. Rejected as over-engineering for 7 static strings; the constant can be co-located in `PanelCreationModal.tsx` for now and extracted later if the registry grows.

### Decision: Selected state via `:focus-visible` / hover, not a persisted React state

**Why**: Since clicking a card immediately advances to step 2, there is no meaningful "user has selected card X and is deciding" moment on the type-select step. The highlight requirement is best served by a CSS `:hover` + `:focus-visible` accent treatment rather than new React state. This keeps the component simple and avoids a redundant `selectedType` on step 1.

**Alternative considered**: Adding a hover-and-hold pattern or a two-step select-then-confirm. Rejected as scope creep; HEL-138 can address that UX upgrade if needed.

### Decision: Add `description` to the existing `PANEL_TYPES` array shape

`PANEL_TYPES` becomes `{ value: PanelType; label: string; icon: string; description: string }[]`. The card renders three stacked elements: icon (top), label (middle), description (bottom, smaller muted text). CSS is added to `PanelCreationModal.css`.

## Risks / Trade-offs

- [Emoji icons are platform-rendered] — Emoji icons can look inconsistent across OS/browser. Mitigation: this is a known limitation of the current implementation; replacing with SVG icons is future work outside this ticket's scope.
- [Wider modal] — Adding a description line increases card height. The grid may need a narrower column count or the modal max-width may increase. Mitigation: adjust CSS to use 3 columns (from 4) if cards become too tall, or increase `max-width` to ~600 px.

## Planner Notes

Self-approved decisions:
1. No two-step selection UX change — auto-advance stays, highlight is CSS-only
2. Description strings authored inline in `PANEL_TYPES` constant
3. CSS-only selected state using `:hover` + `:focus-visible` accent; no new React state
