## Context

The app now has a polished theme system, a full-width dashboard shell, and a grid-based panel foundation, but those visuals are still fixed by code. `HEL-16` turns appearance into data by adding nested `appearance` objects on dashboards and panels, then exposing frontend controls that let users customize the dashboard background and panel surface presentation. Because this ticket includes both frontend and backend work, the model needs to stay small, explicit, and easy to extend.

## Goals / Non-Goals

**Goals:**
- Add a nested `appearance` object to both dashboard and panel resources.
- Persist dashboard background configuration through the backend.
- Persist panel background, color, and transparency configuration through the backend.
- Add frontend controls to edit and preview those appearance values.
- Apply appearance settings without bypassing the shared theme/token system from `HEL-15`.
- Keep the appearance model modular and reusable for future settings.

**Non-Goals:**
- User accounts or per-user server-side preference models.
- Image uploads or advanced asset management for backgrounds.
- Full design-presets/templating workflows.
- Persisted draggable/resizable panel layout state.

## Decisions

### Use nested `appearance` objects on both resources
Dashboards and panels will each expose a nested `appearance` object rather than new top-level style fields. This keeps resource contracts cleaner and gives future settings a dedicated namespace.

Alternative considered:
- Adding many top-level appearance fields was rejected because it would make the resource shape noisy and harder to extend.

### Keep the first appearance model intentionally small
The initial dashboard appearance model will focus on dashboard background styling. The initial panel appearance model will focus on background, color, and transparency. This covers the requested product surface while avoiding an oversized first contract.

Alternative considered:
- Attempting to model every possible visual setting now was rejected because it would slow delivery and create unnecessary backend/frontend complexity.

### Apply appearance settings on top of the existing theme system
Appearance settings will complement the `HEL-15` theme foundation rather than replacing it. Theme tokens still provide the base look, while resource appearance values provide overrides where allowed.

Alternative considered:
- Letting resource appearance bypass the token system entirely was rejected because it would splinter styling behavior and make light/dark compatibility harder.

### Use explicit update flows instead of local-only editing
Frontend controls will update backend-backed resource appearance state rather than staying as temporary local UI state. That keeps the feature aligned with the ticket’s persistence goal.

Alternative considered:
- Local-only preview controls were rejected because they would not satisfy the acceptance criteria around backend-backed persistence.

### Start with simple, typed editing controls
The editing UI should use straightforward controls such as color inputs, transparency sliders, and simple background selectors so the model stays easy to test and reason about.

Alternative considered:
- Building a complex design editor in this ticket was rejected because the request is about configurable appearance, not a full visual builder.

## Risks / Trade-offs

- [Appearance overrides could clash with theme readability] → Constrain the first version to explicit fields and keep theme tokens as the base layer.
- [Backend and frontend contracts could drift] → Add schemas and response/request tests for appearance objects on both resources.
- [Preview/edit flows could sprawl across components] → Keep appearance types and update flows centralized in typed modules and feature state.
