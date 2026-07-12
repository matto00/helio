- `frontend/src/features/panels/ui/creationSteps/TypeSelectStep.tsx` — removed the `divider` entry
  from the `PANEL_TYPES` catalogue and the now-unused `faMinus` icon import (task 1.1).
- `frontend/src/features/panels/ui/creationSteps/NameEntryStep.tsx` — removed the
  `selectedType === "divider"` branch, the `dividerConfig` prop, the `DividerCreatorFields` import,
  and the `DividerTypeConfig` import (task 1.2).
- `frontend/src/features/panels/ui/PanelCreationModal.tsx` — removed the `dividerConfig` derivation
  and its pass-through to `NameEntryStep`, the `DividerTypeConfig` import, and updated the
  `PANEL_TEMPLATES` lookup to `selectedType ? (PANEL_TEMPLATES[selectedType] ?? []) : []` to match the
  new partial map type (tasks 1.3, 1.6).
- `frontend/src/features/panels/ui/creators/DividerCreatorFields.tsx` — deleted; dead code after 1.2
  (task 1.4).
- `frontend/src/features/panels/state/panelTemplates.ts` — removed the `divider` key from
  `PANEL_TEMPLATES`; changed its type to `Partial<Record<PanelType, PanelTemplate[]>>` (task 1.5).
- `frontend/src/features/panels/types/panel.ts` — removed the `DividerTypeConfig` type and its member
  from the `TypeConfig` union. Left `DividerOrientation`, `DividerPanelConfig`, `DividerPanel`,
  `emptyDividerConfig`, and the `divider` case in `emptyConfigForKind` untouched — still required for
  rendering/editing existing panels and `PanelKind` switch-exhaustiveness (task 1.7).
- `frontend/src/features/panels/ui/creators/creatorTypes.ts` — deleted the `case "divider":` arm from
  `hasNonEmptyTypeConfig`'s switch over `TypeConfig` (no exhaustiveness reason to keep it once the
  literal left the union) (task 1.8).
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — `buildPreviewPanel`'s `case "divider":`
  arm stays for `PanelType` exhaustiveness, but the inner `typeConfig?.type === "divider"` narrowing
  was removed (structurally required, functionally dead now that the picker can never select divider)
  (task 1.9).
- `frontend/src/features/panels/state/panelPayloads.ts` — `seedCreateConfig`'s `case "divider":` arm
  stays for `PanelKind` exhaustiveness, but the inner `typeConfig?.type === "divider"` narrowing was
  removed; the arm now just returns the unmodified `base` config (task 1.10).
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — updated the type-picker assertion
  to expect 6 cards with no Divider card, removed the divider-selection creation-flow test, removed
  the "4.4 orientation selector appears in step 3 for divider type" test, and dropped the now-unused
  `makeDividerPanel` fixture import (task 3.1).

## Verified unchanged (no code edits)

- `frontend/src/features/panels/ui/DividerPanel.tsx` / `.css`, `DividerRenderer.tsx`, `DividerEditor.tsx`,
  `PanelDetailModal.tsx`'s divider branch, `panelThunks.ts`'s `updatePanelDivider` — render/edit paths
  for existing divider panels, untouched per design.md (task 2.1). Confirmed via a clean
  `npm run build` and the full Jest suite passing, including `DividerPanel.test.tsx` and the divider
  sections of `PanelDetailModal.test.tsx` / `PanelDetailModal.aggregation.test.tsx` (task 3.2).
- No backend files changed — `DividerPanel.scala`, `PanelRowMapper.scala`, `RequestValidation.scala`,
  `DashboardProposalService.scala` retain `divider` support for back-compat per proposal.md/design.md.
- No schema files changed (`schemas/**`) — no wire-contract change.

## Spec deltas (documentation only, no source-code impact beyond the above)

- `openspec/changes/remove-divider-panel-type/specs/panel-type-picker-cards/spec.md`
- `openspec/changes/remove-divider-panel-type/specs/panel-type-selector/spec.md`
- `openspec/changes/remove-divider-panel-type/specs/panel-creation-modal/spec.md`
- `openspec/changes/remove-divider-panel-type/specs/panel-creation-type-config/spec.md`
- `openspec/changes/remove-divider-panel-type/specs/divider-panel-type/spec.md`
