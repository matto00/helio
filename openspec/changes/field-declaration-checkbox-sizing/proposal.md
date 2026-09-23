## Why

`FieldDeclarationTable`'s "Required" checkbox is a bare native `<input type="checkbox">`
with no sizing/accent styling, rendering at the browser's native ~13px default next to
the 32px token-sized text/select inputs in the same row — the same divergence
`DatasetRowGrid.css` (HEL-1080) already fixed and documented for its own checkbox.
Pure visual polish; no functional, AC, or accessibility regression today, but it's a
visible inconsistency in a shipping UI.

## What Changes

- Add a `field-declaration-table__checkbox` class to the native checkbox input in
  `FieldDeclarationTable.tsx` (currently unstyled).
- Add a matching CSS rule to `FieldDeclarationTable.css` mirroring
  `DatasetRowGrid.css`'s `.dataset-row-grid__draft-checkbox` treatment: `width: 18px`,
  `height: 18px`, `accent-color: var(--app-accent)`.
- No change to component props, the `required` boolean state, or any other behavior.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
(none — pure visual/styling fix, no spec-level behavior change)

## Impact

- `frontend/src/features/sources/ui/FieldDeclarationTable.tsx` (add className)
- `frontend/src/features/sources/ui/FieldDeclarationTable.css` (add checkbox rule)
- No backend, schema, or API impact. No migration.

## Non-goals

- Not building a custom checkbox component — mirrors the existing native-checkbox +
  `accent-color` pattern already precedented in `DatasetRowGrid.css`.
- Not touching `DatasetRowGrid.css` itself, or any other checkbox in the app.
