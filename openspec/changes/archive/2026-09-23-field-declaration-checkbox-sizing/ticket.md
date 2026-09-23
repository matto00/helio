# HEL-1125: FieldDeclarationTable's "Required" checkbox renders at native 13px size, inconsistent with 32px token-sized inputs

## Description

Follow-up from HEL-1079 (final-gate skeptic review, round 2, non-blocking note).

`FieldDeclarationTable`'s "Required" checkbox is a bare native `<input type="checkbox">` with `accent-color: auto`, rendering at ~13×13px next to the 32px token-sized text/select inputs in the same row. This is the same class of divergence `DatasetRowGrid.css` (HEL-1080) already fixed and documented for its own checkbox.

No functional, AC, or accessibility impact — pure visual polish. Fix by applying the same sizing/accent treatment `DatasetRowGrid.css` uses for its checkbox to `FieldDeclarationTable.css`.

Parent: HEL-1072 (v0.8 Interactive Data & Write-Back)

## Acceptance Criteria

- `FieldDeclarationTable`'s "Required" checkbox is visually sized/styled to match the sizing/accent treatment `DatasetRowGrid.css`'s `.dataset-row-grid__draft-checkbox` already applies (18px × 18px, `accent-color: var(--app-accent)`), instead of rendering at the browser's native ~13px default.
- The fix is CSS-only (styling `FieldDeclarationTable.css` and adding a class to the existing native `<input type="checkbox">` in `FieldDeclarationTable.tsx`) — no change to functional behavior, the `required` boolean state, or the component's public props/contract.
- The checkbox retains its existing `aria-label` (`Field {n} required`) and keyboard/focus behavior — computed accessible name/state and focus ring are unchanged and verified, not merely assumed from jsdom element presence.
- Verified visually against the running app in both light and dark themes — token compliance (using `--app-accent`) alone does not establish visual cohesion; must actually look aligned with the row's 32px-token-sized inputs in both themes.
- No migration required (frontend CSS/component change only).

## Notes (Driver Brief)

- Verify the DatasetRowGrid.css (HEL-1080) checkbox treatment actually exists before copying it — CONFIRMED during Setup premise validation: `.dataset-row-grid__draft-checkbox { width: 18px; height: 18px; accent-color: var(--app-accent); align-self: flex-start; margin-top: var(--space-1); }`.
- DESIGN.md is binding.
- Parallel lane HEL-505 (backend expensive-op guards) is running concurrently in another worktree — no expected file overlap (backend-only vs. this ticket's frontend-only scope). May claim Flyway V109; this ticket needs no migration — if one turns out to be needed, escalate for a number rather than deriving one.
- Do NOT change the state of epic HEL-1072 (the parent) — driver will handle the epic after merge.
