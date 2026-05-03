## Context

The image panel type (HEL-165) established the full pattern for adding new cosmetic panel types:
sealed `PanelType` trait in `model.scala`, Flyway column migration, `PanelRow` extension,
`PanelRepository` update/read logic, `JsonProtocols` serialization, and a React component plus
settings controls on the frontend. The divider panel type follows this pattern exactly.

## Goals / Non-Goals

**Goals:**
- Add `"divider"` to the `PanelType` enum and API validation.
- Persist three divider fields: `dividerOrientation` (`horizontal|vertical`), `dividerWeight`
  (int px, default 1), `dividerColor` (CSS string, default token color).
- Render a styled rule in the panel body when `type: "divider"`.
- Expose orientation, weight, and color controls in the settings sidebar.

**Non-Goals:**
- No data binding or DataType integration.
- No per-breakpoint orientation variation.
- No animation or gradient effects.

## Decisions

### D1 — Follow image panel column pattern for new fields
Add `divider_orientation`, `divider_weight`, `divider_color` columns to the `panels` table in a
single Flyway migration (`V21__divider_panel_type.sql`). This keeps all type-specific nullable
columns in the same table, consistent with `image_url` / `image_fit`.
_Alternative_: JSONB `extra` column for all type-specific data — rejected because it complicates
typed Slick mappings and doesn't add value with so few fields.

### D2 — Default values at the application layer, not DB
`dividerWeight` defaults to `1` and `dividerColor` defaults to the design token `--color-border`
in the frontend renderer, not via DB default columns. This lets the defaults evolve without
migrations.
_Alternative_: DB DEFAULT constraints — rejected because color tokens are a frontend concern.

### D3 — Reuse `updateImageFields` pattern for divider update
`PanelRepository` already has `updateImageFields`. Add a parallel `updateDividerFields` method
that follows the same "None = leave unchanged" semantics, called from `PanelRoutes`.

### D4 — DividerPanel as a standalone React component
Mirror `ImagePanel.tsx` → `DividerPanel.tsx`. `PanelContent.tsx` switches on panel type.
Settings sidebar adds a "Divider" section alongside "Image" settings, gated on `panel.type`.

## Risks / Trade-offs

- [Risk] Orientation `vertical` inside a panel body requires the panel to be taller than wide or
  the grid layout to allow narrow columns — Mitigation: no constraint enforced; layout is user's
  responsibility.
- [Risk] Free-form `dividerColor` string allows invalid CSS — Mitigation: use a color input `<input
  type="color">` in the settings sidebar, which always produces a valid hex value.

## Migration Plan

1. Flyway `V21__divider_panel_type.sql` adds three nullable columns — safe, no backfill needed.
2. Backend restart picks up new columns; existing panels unaffected (all three fields null).
3. Frontend deploy adds the new panel type rendering and settings UI.
4. No rollback concern: new columns are nullable and existing code ignores unknown fields.

## Planner Notes

Self-approved: additive change following established image panel pattern. No breaking API changes,
no external dependencies, no architectural novelty.
