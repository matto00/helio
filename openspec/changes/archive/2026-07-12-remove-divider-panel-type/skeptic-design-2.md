## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all five spec deltas fresh (cold
  spawn), not relying on round 1's narrative.
- Read the current source of the three files round 1 flagged as compile breaks:
  `frontend/src/features/panels/ui/creators/creatorTypes.ts`,
  `frontend/src/features/panels/ui/PanelCreationPreview.tsx`,
  `frontend/src/features/panels/state/panelPayloads.ts`. Confirmed the `case "divider":` shapes
  match round 1's description exactly (lines 32-33, 35-45, 75-82 respectively).
- Confirmed tasks 1.8-1.10 and design.md's corrected Risks section (lines 71-87) prescribe the
  right fix for each:
  - 1.8 (`creatorTypes.ts`): delete the `case "divider":` arm entirely — correct, since
    `hasNonEmptyTypeConfig` switches over `TypeConfig` (no longer includes `"divider"` once 1.7
    lands) and has no `PanelKind`-exhaustiveness reason to keep the arm.
  - 1.9 (`PanelCreationPreview.tsx`): keep the outer `case "divider":` (required for
    `PanelType`/`PanelKind` exhaustiveness) but drop the inner `typeConfig?.type === "divider"`
    narrowing, returning the unmodified `emptyConfigForKind(type)` result.
  - 1.10 (`panelPayloads.ts`): same pattern — keep the outer case, drop the inner narrowing, return
    `base`.
  - **Reproduced this in isolation**: wrote a scratch TypeScript file
    (`/tmp/.../scratchpad/tsrepro/repro.ts`) modeling the post-fix state (a 3-member `TypeConfig`
    union with `divider` removed, alongside an unchanged 7-member `PanelType`) and applied exactly
    the three fixes tasks 1.8-1.10 describe. Ran
    `frontend/node_modules/.bin/tsc --strict --noEmit` against it: **exit 0, no errors.** This
    confirms the planned mitigations actually resolve the `TS2678`/`TS2367` breaks round 1 found,
    not just that they sound plausible on paper.
- Re-ran the full grep round 1's change request #3 asked for:
  `grep -rn '"divider"' frontend/src/features/panels/{ui,state}` plus a companion
  `grep -rln 'TypeConfig'` to scope to files that actually reference the union. This surfaced one
  hit not explicitly named in design.md's Risks section:
  `PanelCreationModal.tsx:259-260` — `const dividerConfig: DividerTypeConfig = typeConfig?.type ===
  "divider" ? typeConfig : { type: "divider" };`. Checked whether this is a missed fourth call
  site: it is **not** — task 1.3 ("`PanelCreationModal.tsx`: remove the `dividerConfig` derivation
  and its pass-through to `NameEntryStep`, and the `DividerTypeConfig` import") already covers
  exactly this line, and its consumer (`NameEntryStep.tsx`'s `dividerConfig` prop and
  `selectedType === "divider"` branch at lines 36/54/90-91) is covered by task 1.2. Verified with
  `grep -n 'dividerConfig\|DividerTypeConfig\|DividerCreatorFields'` across both files that every
  reference resolves to a task already in the list (1.1-1.4, 1.8-1.10) — no orphaned import or
  dangling reference survives the plan.
- Also grepped all `DividerTypeConfig` references project-wide
  (`grep -rn 'DividerTypeConfig' frontend/src`): every hit maps to a file/line already covered by
  tasks 1.2, 1.3, 1.4, or 1.7. No fifth site.
- Re-confirmed (briefly, not re-deriving) the parts round 1 found sound, reading them fresh: the
  five spec deltas (`panel-type-picker-cards`, `panel-type-selector`, `panel-creation-modal`,
  `panel-creation-type-config`, `divider-panel-type`) are internally consistent, correctly narrow
  the creatable set to six types, and correctly preserve the legacy divider path (render/edit/PATCH/
  proposal/duplicate) with an explicit new requirement in `divider-panel-type` documenting the
  legacy-only status. Decision 2 (`Partial<Record<PanelType, PanelTemplate[]>>`) and Decision 3
  (preserve `DividerEditor`) still hold against current source — nothing looks off on a fresh read.

### Verdict: CONFIRM

### Non-blocking notes

- The plan is now internally complete: every `TypeConfig`-narrowing call site on `"divider"` found
  by an exhaustive grep (4 total: `creatorTypes.ts`, `PanelCreationPreview.tsx`,
  `panelPayloads.ts`, `PanelCreationModal.tsx`) maps to a task, and the isolated `tsc --strict`
  reproduction confirms the three novel fixes (1.8-1.10) actually compile once applied — this
  wasn't just re-asserted, it was re-verified from ground truth.
- Suggest the executor still runs `npm run lint && tsc --noEmit` (or the equivalent full build)
  against the real files after each of 1.7-1.10 lands, per task 3.3 — the isolated repro proves the
  *pattern* compiles, not that there isn't some other project-specific `tsconfig` nuance (e.g.
  `isolatedModules`, path aliases) that behaves differently at full-project scope. This is already
  covered by task 3.3, just flagging it as the actual gate that closes the loop.
