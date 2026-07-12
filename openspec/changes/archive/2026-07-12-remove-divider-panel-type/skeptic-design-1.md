## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all five spec deltas
  (`panel-type-picker-cards`, `panel-type-selector`, `panel-creation-modal`,
  `panel-creation-type-config`, `divider-panel-type`) in full.
- Read the actual current-state source referenced by the ticket:
  `TypeSelectStep.tsx`, `NameEntryStep.tsx`, `PanelCreationModal.tsx`,
  `panelTemplates.ts`, `types/panel.ts`, `DividerCreatorFields.tsx`,
  `panelNarrowing.ts`, `DividerEditor.tsx`, `DividerPanel.scala`.
- Confirmed the design's factual claims about current state are accurate:
  - `divider` is a full picker card in `TypeSelectStep.tsx` (lines 54-59) and a
    `PANEL_TEMPLATES` key (`panelTemplates.ts` lines 102-115, currently
    `Record<PanelType, PanelTemplate[]>`, non-partial).
  - Backend: `DividerPanel.scala` is a real ADT case; `PanelRowMapper.scala:41-42,67-69,82,123-127`
    reads/writes `dividerOrientation`/`dividerWeight`/`dividerColor` DB columns;
    `DashboardProposalService.scala:82-83,187` validates/creates divider panels with an
    initial orientation. The design's "leave backend untouched, no migration" claim is
    consistent with this — duplication/export/import are backend-only code paths untouched
    by the frontend picker removal, so no risk there.
  - `DividerEditor.tsx` and `PanelDetailModal`'s divider branch operate on `DividerPanel`/
    `DividerPanelConfig` (the persisted ADT, untouched by this change), not on
    `TypeConfig` — confirms Decision 3 (preserve editing) is safe as designed.
- **Reproduced a concrete compile break the design/tasks do not account for.** Task 1.7
  removes `DividerTypeConfig` from the `TypeConfig` union in `types/panel.ts`. I found three
  call sites elsewhere in the codebase that narrow on `TypeConfig`'s `"divider"` member and
  are **not listed anywhere in design.md's Impact section or tasks.md**:
  1. `frontend/src/features/panels/ui/creators/creatorTypes.ts` — `hasNonEmptyTypeConfig`
     switches on `config.type` (a `TypeConfig`) with a `case "divider": return
     !!config.dividerOrientation;` branch (lines 32-33).
  2. `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — `buildPreviewPanel`'s
     `case "divider":` block (lines 35-45) does `typeConfig?.type === "divider"` where
     `typeConfig: TypeConfig | null | undefined`.
  3. `frontend/src/features/panels/state/panelPayloads.ts` — `seedCreateConfig`'s
     `case "divider":` block (lines 75-82) does the identical
     `typeConfig?.type === "divider"` comparison.
  I verified with `tsc --strict --noEmit` against isolated repros of each pattern (using the
  project's own frontend/node_modules/typescript) that once a `"divider"` literal is removed
  from a union, both patterns fail to compile:
  - Switch-case comparable-to-union check (creatorTypes.ts pattern): `error TS2678: Type
    '"divider"' is not comparable to type '"metric" | "chart"'.`
  - Equality-narrowing check (PanelCreationPreview.tsx / panelPayloads.ts pattern): `error
    TS2367: This comparison appears to be unintentional because the types '"image" |
    "metric" | undefined' and '"divider"' have no overlap.`
  design.md's own Risks section *does* mention `PanelCreationPreview.tsx` / `panelPayloads.ts`,
  but dismisses the risk on the wrong grounds — it reasons only about the **outer** `switch
  (type)` over `PanelKind` (which stays exhaustive, fine), not the **inner**
  `typeConfig?.type === "divider"` narrowing against the now-narrower `TypeConfig`, which is
  what actually breaks. `creatorTypes.ts` isn't mentioned at all.

### Verdict: REFUTE

### Change Requests

1. Add tasks (and corresponding design.md Impact-section entries) to fix the three
   `TypeConfig`-narrowing call sites that break once `DividerTypeConfig` is dropped from the
   `TypeConfig` union (task 1.7):
   - `frontend/src/features/panels/ui/creators/creatorTypes.ts`: remove the `case "divider":`
     branch from `hasNonEmptyTypeConfig` (mirrors task 1.2/1.7's treatment of the
     creation-time-only divider config — this function operates over `TypeConfig`, not
     `PanelKind`, so it has no exhaustiveness reason to keep the case, unlike
     `emptyConfigForKind`).
   - `frontend/src/features/panels/ui/PanelCreationPreview.tsx`: remove the `case "divider":`
     block from `buildPreviewPanel`'s switch over `PanelType`/`PanelKind` (the outer switch can
     stay exhaustive over 7 `PanelKind` values only if this case no longer references the
     removed `TypeConfig` member — either delete the case, since divider can never reach the
     preview once the picker never offers it, and add a `never`-style fallback, or explicitly
     document/handle it without narrowing on the removed union member).
   - `frontend/src/features/panels/state/panelPayloads.ts`: same fix in `seedCreateConfig`'s
     `case "divider":` block for the identical reason.
   Whichever way the executor resolves these (delete the branches vs. rewrite them without
   narrowing on the removed `TypeConfig` member), the design doc's Decisions/Risks section
   should say which, since it changes the shape of `buildPreviewPanel`'s and
   `seedCreateConfig`'s switch (both currently exhaustive over all 7 `PanelKind` values,
   including `divider`, which per Decision 1 must remain a valid `PanelKind` for
   `emptyConfigForKind` exhaustiveness — so these two switches likely need to keep a
   `case "divider":` arm structurally, just without the now-invalid inner narrowing).
2. Correct design.md's Risk bullet (lines 71-74) — it currently asserts "no change needed" for
   `PanelCreationPreview.tsx` / `panelPayloads.ts`, which is contradicted by the `tsc` repro
   above. Update it to reflect the actual required fix (item 1) instead of dismissing it.
3. Re-run a full grep for `TypeConfig`-narrowing on `"divider"` (e.g.
   `grep -rn '"divider"' frontend/src/features/panels/{ui,state}` scoped to files that
   reference `TypeConfig`, not `Panel`/`PanelKind`) before implementation starts, to confirm
   these three are the complete set and no fourth call site was missed by this review.

### Non-blocking notes

- The rest of the design is sound: Decision 1 (hide-from-creation vs. full removal), Decision 2
  (`Partial<Record<PanelType, PanelTemplate[]>>`), Decision 3 (preserve `DividerEditor`), and
  Decision 4 (no backend validation, since duplication/export-import reuse the create path) are
  all consistent with ground truth in the actual backend/frontend code, not just asserted.
- The five spec deltas accurately reflect the intended behavior change and are internally
  consistent with each other and with the (unmodified) sibling specs — no contradictions found.
- `tasks.md` section 3 (test updates) correctly anticipates the deleted creation-flow tests and
  correctly identifies `DividerPanel.test.tsx` / `PanelDetailModal` divider tests as
  should-pass-unmodified. Once change requests 1-2 are addressed, a task should be added under
  section 3 for any new/updated test coverage on `creatorTypes.ts` / `PanelCreationPreview.tsx`
  / `panelPayloads.ts` if their divider branches are restructured rather than simply deleted.
