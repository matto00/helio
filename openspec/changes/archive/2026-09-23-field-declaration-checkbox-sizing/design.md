## Context

`FieldDeclarationTable.tsx` renders one native `<input type="checkbox">` (line ~162)
for the "Required" column, with no `className` and no matching CSS rule in
`FieldDeclarationTable.css`. `DatasetRowGrid.css` already solved the identical problem
for its own draft-row Required checkbox (HEL-1080, skeptic-final-3.md non-blocking
note) via `.dataset-row-grid__draft-checkbox { width: 18px; height: 18px;
accent-color: var(--app-accent); align-self: flex-start; margin-top: var(--space-1); }`.
See proposal.md - Why.

## Goals / Non-Goals

**Goals:**
- Mirror the precedented HEL-1080 checkbox treatment onto `FieldDeclarationTable`'s
  checkbox: same 18px×18px sizing, same `accent-color: var(--app-accent)`.
- Preserve existing `aria-label`, keyboard operability, and focus-ring behavior exactly.

**Non-Goals:**
- Not building a shared/reusable checkbox component across the two tables — a single
  small CSS rule, scoped to this component, matches the codebase's existing pattern
  (DatasetRowGrid.css didn't extract one either).
- Not changing `--app-accent` or any other design token.
- Not touching the checkbox's `<td>` layout/alignment beyond what the new class needs.

## Decisions

**Decision 1 — reuse the exact HEL-1080 values (18px/18px, `accent-color:
var(--app-accent)`), not DESIGN.md's `--control-sm`/`--control-md` tokens.** A checkbox
is conventionally sized smaller than a text/select input's control height (this is
true of the DatasetRowGrid precedent too, whose own inputs are ~25px tall against an
18px checkbox) — matching the *already-shipped, already-skeptic-reviewed* sibling
treatment is the safer, more consistent choice than inventing a new checkbox sizing
convention against a token meant for input/button heights. Alternative considered:
size the checkbox to `--control-sm` (28px) directly — rejected as inconsistent with
the one precedent this ticket is explicitly asked to mirror, and disproportionately
large for a checkbox glyph.

**Decision 2 — scoped class name `field-declaration-table__checkbox`**, following this
file's own existing BEM-ish naming (`field-declaration-table__actions`), not a shared
class imported from `DatasetRowGrid.css` — the two components' CSS files are not
otherwise coupled, and duplicating six lines of CSS is cheaper than introducing a
cross-feature-folder CSS dependency for a single rule.

**Decision 3 — table cell alignment.** `DatasetRowGrid.css`'s checkbox sets
`align-self: flex-start` because that checkbox lives inside a flex `__draft-field`
column. `FieldDeclarationTable`'s checkbox lives directly inside a `<td>` (no flex
parent) — `align-self` would be a no-op there. Omit it; add no flex-alignment
properties this table doesn't already establish.

## Risks / Trade-offs

- [Risk] Visual regression in dark theme if `--app-accent` doesn't render legibly
  against the table's dark-theme row background → Mitigation: evaluator/skeptic verify
  against the running app in both light and dark themes (not just light), per ticket AC.
- [Risk] `aria-label`/focus semantics silently drop if the class change is paired with
  an unrelated markup change → Mitigation: this is a pure additive `className` on the
  existing `<input>` element; no other JSX attributes touched.

## Migration Plan

None — CSS/markup-only change, no data, no backend, no migration.
