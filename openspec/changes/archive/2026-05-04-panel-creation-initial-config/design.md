## Context

The panel creation modal currently has three steps: (1) type picker, (2) template picker, (3) title
entry with live preview. Step 3 only collects a title. Users who want to set a chart type, image URL,
metric unit, or divider orientation must open the detail modal immediately after creation. This design
adds an optional config section to step 3 for the panel types that benefit from it.

The existing modal is `frontend/src/components/PanelCreationModal.tsx`. Panel creation is driven by
the `createPanel` thunk in `frontend/src/store/panelsSlice.ts`. The backend `POST /api/panels` route
already accepts the same optional config fields as `PATCH /api/panels/:id` — no backend changes are
needed for the fields themselves, though we should verify acceptance in the route handler.

## Goals / Non-Goals

**Goals:**
- Render per-type optional fields in step 3 of `PanelCreationModal.tsx`
- Forward collected field values through `createPanel` thunk in the API payload
- Keep the form compact; no new modal steps

**Non-Goals:**
- Colors, weights, data bindings, and field mappings remain in the detail modal
- No changes to steps 1 or 2 (type picker, template picker)
- No backend schema changes; all fields are already accepted by the API

## Decisions

**Decision: Inline config fields in step 3, not a new step.**
Adding a step 4 increases navigation friction. The config fields are few (≤2 per type) and optional,
so embedding them below the title field keeps the flow linear and compact.

**Decision: Config state lives in the modal's local state, not Redux.**
The creation modal already tracks local state (selectedType, selectedTemplate, title). The new fields
follow the same pattern — they reset when the modal closes, same as title. Persisting them in Redux
would be over-engineering.

**Decision: No backend changes required.**
`POST /api/panels` uses the same `PanelAppearance` / config structures as `PATCH`. The optional
fields are already deserialized from JSON. Only the frontend needs to populate them.

**Decision: Collect config as a typed union.**
A union `{ type: 'metric'; valueLabel?: string; unit?: string } | { type: 'chart'; chartType?: ... }`
etc. maps cleanly from selectedType and avoids a loose `Record<string, unknown>`.

## Risks / Trade-offs

- [Risk] Preview pane in step 3 may not reflect the new config fields immediately → Mitigation:
  Pass the config values into `PanelCreationPreview` the same way `title` is passed; update preview
  live on input change.
- [Risk] Dirty-state detection for discard prompt doesn't cover the new fields → Mitigation: extend
  the "is dirty" check to include any non-empty config field value.

## Planner Notes

Self-approved: purely additive frontend change, optional API fields already accepted by the backend,
no breaking changes, no new external dependencies.
