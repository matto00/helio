# HEL-255 — Table panel config rework

**Status:** In Progress · **Priority:** Medium · **Project:** Helio v1.5 — Panel System v2 (parent epic HEL-240)
**URL:** https://linear.app/helioapp/issue/HEL-255/table-panel-config-rework

## Description

Redesign Table panel config to surface the new DataGrid capabilities cleanly.

### Config surface

- **Cell density** dropdown (condensed / normal / spacious)
- **Column visibility** — which fields from the bound DataType are shown
- **Column order** — drag to reorder (or simple up/down controls)
- **Column widths** persisted from in-grid drag (no separate config needed)
- Future: per-column formatters, sort defaults — out of scope here

### Definition of done

- Table panel config UI redesigned with the above controls
- All controls map cleanly to DataGrid props
- Config language matches the panel-config redesign pattern from Epic A
- Existing Table panels migrate cleanly (default density = normal; all columns visible in DataType order)

Depends on unified DataGrid primitive, density, draggable widths (sibling tickets in this epic).

## SCOPE DECISION (escalated and RESOLVED — binding)

The original "config-UI-only" directive was corrected by escalation: ground truth shows column-width
storage exists (HEL-253) but per-panel density and column visibility/order have NO persistence.
**Resolution: Option 1 — minimal storage extension**, exactly this narrow:

- Optional `density` and `columnOrder` (ordered visible-column key list; absent = all columns in
  DataType order) on `TablePanelConfig` **only**. No other panel kinds, no generalized "display
  config" abstraction.
- Follow the HEL-253 pattern end-to-end: TS type + `schemas/panel.schema.json` +
  `backend/.../domain/panels/TablePanel.scala` parse/patch + `PanelRowMapper` + **one** Flyway
  `ALTER TABLE panels ADD COLUMN` migration. Absent = defaults (density normal, all columns visible
  in DataType order) → zero data migration.
- **KNOWN PITFALL:** spray-json omits `Option=None` fields on the wire — normalize at the service
  boundary and include tests where the fields are **ABSENT** from the payload, not just null. A
  sibling bug (PanelRowMapper markdown arm dropping `type_id`/`field_mapping`) was caught in
  HEL-245 — give PanelRowMapper's **table arm** the same scrutiny.
- The vestigial `columns` fieldMapping slot (in `panelSlots.ts`): do NOT build on it. If removing
  it is trivially safe and in-scope, remove it; otherwise leave it and note as a follow-up.
- The config-editor CONTROLS (density dropdown, column visibility/order, reset-widths) follow the
  config language established by HEL-243/244/245 (`frontend/src/features/panels/ui/editors/`).
- Anything beyond the above (per-column formatters, sort defaults, other panel kinds) is scope
  creep — cut it.

## Session emphases (binding for executor, evaluator, skeptic)

1. **Elevated style/UX bar:** strictly honor DESIGN.md (tokens, spacing/type scales, canonical breakpoints 1440/1100/768/430, shared components).
2. **MOBILE IS A FIRST-CLASS VERIFICATION TARGET.** Mobile shell activates below 768px (read-only MobilePanelStack, BottomNav, MobileNavSheet). Evaluator AND skeptic must resize to ~390×844 and verify:
   - (a) Table panels render well in the mobile stack with the new config applied (density, hidden columns, column order);
   - (b) the new config controls in the panel-detail dialog meet ≥44px touch targets at mobile width — precedent: HEL-245 (PR #230, merged) added a `@media (max-width: 768px)` block in `PanelDetailModal.css` bumping controls to 44px, plus a CSS-lock test (`PanelDetailModal.css.test.ts`); **extend that pattern, don't reinvent it**;
   - (c) no horizontal overflow in the mobile shell.
3. Clean up trivial style debt (dead CSS, non-token values, inconsistent spacing) in files being edited anyway — in-scope files only, not an excuse for unrelated refactors.

## Operational hygiene (binding — prior run had an incident)

- Playwright screenshots go to the session scratchpad or the worktree's gitignored tmp area — NEVER the repo root.
- NEVER bulk-delete files by glob (e.g. `rm -f *.png`). Delete only files you created, by exact name.
- A parallel worktree run (HEL-245 cleanup) may run briefly; stay inside this worktree and its ports (dev 5428, backend 8335).

## Migration note

Existing Table panels must migrate cleanly with defaults: density = normal, all columns visible in DataType order (per definition of done). Verify against already-shipped storage semantics — do not add new schema.
