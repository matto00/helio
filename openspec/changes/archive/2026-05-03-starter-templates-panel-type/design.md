## Context

`PanelCreationModal.tsx` currently has a 2-step flow driven by a `Step = "type-select" | "name-entry"` union.
After type selection the user lands directly on the title form. HEL-170 inserts a template-picker step between
these two. Templates are purely frontend constants — no backend, no persistence.

Panel types: metric, chart, text, table, markdown, image, divider.

## Goals / Non-Goals

**Goals:**
- Insert a "template-select" step between type-select and name-entry.
- Ship a `panelTemplates.ts` constants file with 2–3 templates per panel type.
- Pre-fill the title input when the user picks a template.
- Provide a "Start blank" path that skips pre-fill.

**Non-Goals:**
- User-defined or persisted templates.
- Template previews with live data.
- Backend changes.

## Decisions

### D1 — Inline constants file, not Redux

Templates are static data. Storing them in a `panelTemplates.ts` file alongside `PanelCreationModal.tsx`
keeps the footprint small and avoids unnecessary Redux state. Alternative: a feature-slice constant. Rejected —
no async, no cross-component sharing needed.

### D2 — Extend the `Step` type union

Current: `"type-select" | "name-entry"`. New: `"type-select" | "template-select" | "name-entry"`.
`handleTypeSelect` advances to `"template-select"`. A new `handleTemplateSelect(template | null)` accepts a
template or `null` (blank), pre-fills `title` if non-null, then advances to `"name-entry"`.

### D3 — Template shape

```ts
interface PanelTemplate {
  id: string;           // e.g. "metric-kpi"
  label: string;        // display name
  description: string;  // one-liner shown on the card
  defaults: {
    title: string;      // pre-fills the title input
  };
}
```

Only `title` is pre-filled in v1.2 (no type-specific config fields yet). Keeping `defaults` as an object
allows future fields without changing the interface.

### D4 — "Start blank" is a first-class card, not a back button

A "Start blank" card at the end of the template grid navigates to `name-entry` with `title = ""`.
Alternative: secondary "Skip" link. Rejected — a card preserves visual consistency and discoverability.

## Risks / Trade-offs

- [Template step adds a click] Users who always want blank panels now have an extra screen. Mitigation:
  "Start blank" is prominent (last card, visually distinct with a dashed border).
- [Template label bleeds into title] User may not notice the pre-filled title and ship panels with template
  names. Mitigation: title input is auto-focused and visually highlighted to signal editability.

## Planner Notes

- Self-approved: no new external deps, no backend changes, contained frontend addition.
- No schema changes required — `POST /api/panels` already accepts `title` and `type`.
- Existing tests for `PanelCreationModal` will need to be updated to account for the new step.
