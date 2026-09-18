# HEL-1085: Field renderers: text, textarea, number, date, select, checkbox

## Description

The six non-file field types, rendered on-panel and sized for a grid cell.

**AC (a11y, blocking):** every field is reachable and completable by keyboard alone; every field has a programmatic label asserted by **computed accessibility name**, not by DOM presence — jsdom makes presence assertions vacuously true (see HEL-1005). Error messages are associated with their field.

---

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- The six non-file controls (`text`, `textarea`, `number`, `date`, `select`, `checkbox`) of a configured `form` panel render on the panel body, sized for a grid cell.
- Every rendered field is reachable and completable by keyboard alone.
- Every rendered field has a programmatic label, asserted by computed accessibility name (never by DOM presence).
- Error messages are associated with their field (computed ARIA state — `aria-invalid` on the control and the error text resolving as the control's accessible description — never `role="alert"` presence).

## Context

- Parent epic: HEL-1082 (form panel). Prerequisites shipped: HEL-1083 (`820359a0`, `form` PanelKind + config schema + PanelType round-trip), HEL-1084 (`9f6f4d41`, field-type builder with author-time schema consistency).
- Out of scope, separate leaves: HEL-1086 (file upload field), HEL-1087 (submit path), HEL-1088/1089 (counter), HEL-1090 (assembled audit).
- Ticket status was cascaded to Done by the epic close on 2026-09-17 and reopened; premise re-verified against the tree at Setup (`.concertino/runs/HEL-1085/evidence/premise-validation.md`, verdict no-drift).
- Priority: High. Project: Helio v0.8 — Interactive Data & Write-Back.
