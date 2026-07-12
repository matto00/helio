## Context

Divider is one of seven creatable panel types. Since the CS2c-3c ADT overhaul, `divider` is a full
discriminated-union member on both frontend (`DividerPanel`/`DividerPanelConfig` in `types/panel.ts`)
and backend (`DividerPanel.scala`, persisted via `dividerOrientation`/`dividerWeight`/`dividerColor`
columns read/written in `PanelRowMapper.scala`). It also participates in `PATCH /api/panels/:id` and
`POST /api/dashboards/apply-proposal` (AI-authored dashboards may set an initial orientation) — see
`openspec/specs/divider-panel-type/spec.md`. Dashboard duplication and export/import clone panels
through the same repository/create paths, so any dashboard that already contains a divider panel
must continue to round-trip it correctly.

## Goals / Non-Goals

**Goals:**
- Remove `divider` from every UI surface that lets a user *create* a new panel of that type: the
  type-select picker, the step-3 type-config form, and `PANEL_TEMPLATES`.
- Delete the now-dead creation-only code (`DividerCreatorFields`, `DividerTypeConfig`).
- Leave existing divider panels fully functional: they render in the grid, remain editable via the
  detail modal (orientation/weight/color), and survive duplication/export/import.
- Document (not code-change) that the backend and AI-proposal path retain divider support for
  back-compat.

**Non-Goals:**
- No Flyway migration / column removal. The ticket explicitly prefers "leave the column in place" over
  a migration for a low-value cleanup.
- No new backend-level validation to reject `type: "divider"` on `POST /api/panels` or
  `apply-proposal`. Adding one would double as an (undesired) block on duplicating/importing
  dashboards that already contain a divider panel, since those flows reuse the same create path.
- No changes to `DividerRenderer`, `DividerPanel.tsx`, `DividerEditor`, `panelThunks.updatePanelDivider`,
  or any backend Scala file.

## Decisions

**1. Hide-from-creation, not full removal.** Confirmed against the ticket's own fallback text
("leave the column in place... just stop offering the type at creation") and the "leave them
rendering" requirement for existing panels. Only the creation-time slice of the type system
(`DividerTypeConfig`, the picker card, the step-3 fields) is deleted; the render-time slice
(`DividerPanel`, `DividerPanelConfig`, `DividerOrientation`, `isDividerPanel`,
`getDividerOrientation/Weight/Color`) stays untouched — it's still needed to render and edit
pre-existing panels and to satisfy `PanelKind` switch-exhaustiveness in `emptyConfigForKind`.

**2. `PANEL_TEMPLATES` becomes `Partial<Record<PanelType, PanelTemplate[]>>`.** Considered adding a
`CreatablePanelType = Exclude<PanelType, "divider">` alias and threading it through
`PanelCreationModal`'s `selectedType` state, `TypeSelectStep`, and `PANEL_TEMPLATES`. Rejected as
higher blast radius for no behavioral gain — `selectedType` can never be `"divider"` once
`TypeSelectStep`'s catalogue drops the divider card, so the extra type parameter only adds friction.
`Partial<Record<...>>` lets the `divider` key disappear from the templates object (satisfying "remove
divider from PANEL_TEMPLATES") while the lookup site changes from `PANEL_TEMPLATES[selectedType]` to
`PANEL_TEMPLATES[selectedType] ?? []`, a one-line, type-safe change.

**3. DividerEditor / detail-modal editing is preserved, not removed.** The ticket only mentions the
creation-modal picker and `PANEL_TEMPLATES`; it does not ask to strip editing capability from panels
that already exist. Removing edit support would be a regression for any dashboard that already has a
divider (contradicts "behavior-preserving for existing data"), so `PanelDetailModal`'s divider branch,
`DividerEditor.tsx`, and `updatePanelDivider` are left exactly as-is.

**4. Backend and AI-proposal path: document as legacy, no code change.** `DashboardProposalService`
already validates and applies an initial `orientation` for AI-authored divider panels
(`divider-panel-type` spec, "via a dashboard proposal" requirement). Leaving this untouched avoids
scope creep into the agent-native layer and avoids breaking `POST /api/dashboards/:id/duplicate` /
`import`, which clone existing divider panels through the same code paths `POST /api/panels` uses.
The `divider-panel-type` spec gets one added requirement stating explicitly that divider is
legacy-only from the interactive-picker's perspective.

## Risks / Trade-offs

- [Risk] A future contributor sees `DividerPanel`/`DividerPanelConfig` still in the codebase and
  wonders why the "removed" panel type still has full backend/render support → Mitigation: the
  `divider-panel-type` spec delta and this design doc make the legacy-only status explicit, and
  `types/panel.ts`'s existing doc comment already explains the ADT.
- [Risk] Removing `DividerTypeConfig` from the `TypeConfig` union (task 1.7) breaks three call sites
  that narrow on `TypeConfig`'s `"divider"` member — found via `tsc --strict --noEmit` reproduction
  during the design-gate review, not just inspection:
  - `creators/creatorTypes.ts`'s `hasNonEmptyTypeConfig` switches on `config.type: TypeConfig["type"]`
    with a `case "divider":` arm (`TS2678` once the literal is removed from the union) →
    **Mitigation:** delete the `case "divider":` arm entirely. This switch is over `TypeConfig`, not
    `PanelKind`, so — unlike `emptyConfigForKind` — it has no exhaustiveness reason to keep a divider
    branch once the literal leaves the union.
  - `PanelCreationPreview.tsx`'s `buildPreviewPanel` and `panelPayloads.ts`'s `seedCreateConfig` both
    switch over `PanelKind`/`PanelType` (which correctly keeps `"divider"` per Decision 1) but each
    `case "divider":` arm *internally* does `typeConfig?.type === "divider"` (`TS2367` once that
    literal leaves `TypeConfig`) → **Mitigation:** keep the outer `case "divider":` arm (required for
    exhaustiveness over `PanelKind`/`PanelType`), but drop the inner `typeConfig?.type === "divider"`
    narrowing and just return the unmodified `emptyConfigForKind`/base config — this path is
    structurally required but functionally dead now that the picker can never produce
    `type: "divider"` with a populated `typeConfig`.
  See tasks.md 1.8-1.10 for the concrete per-file fixes.
- [Risk] Existing Jest tests assert on the divider card/config in `PanelCreationModal` /
  `TypeSelectStep` → Mitigation: executor updates/removes those specific assertions as part of the
  same change (task list covers this explicitly).

## Planner Notes

Self-approved: no new external dependency, no breaking API change, no architectural shift — this is a
scoped UI-declutter with an explicit backward-compat carve-out already specified by the ticket itself.
Not escalated.
