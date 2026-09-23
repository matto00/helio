### Frontend

- [x] 1.1 Add `field-declaration-table__checkbox` className to the native `<input
      type="checkbox">` in `FieldDeclarationTable.tsx` (the Required column) and
      verify the prop/DOM structure otherwise unchanged (`aria-label`, `checked`,
      `onChange` all preserved).
- [x] 1.2 Add `.field-declaration-table__checkbox { width: 18px; height: 18px;
      accent-color: var(--app-accent); }` to `FieldDeclarationTable.css`, mirroring
      `DatasetRowGrid.css`'s `.dataset-row-grid__draft-checkbox` (per design.md
      Decision 1/2/3), and verify visually against the running dev app in both light
      and dark themes that the checkbox now renders at 18px with the app accent color.

### Tests

- [x] 2.1 Add/update a test asserting the checkbox's computed accessible name/state
      (e.g. `getByRole("checkbox", { name: /required/i })`) rather than mere element
      presence, and that it remains keyboard-operable (focus + toggle via keyboard),
      matching the existing `FieldDeclarationTable` test suite's conventions.
- [x] 2.2 Run `npm run lint`, `npm run typecheck`, and `npm test -- --testPathPatterns=FieldDeclarationTable` and verify all pass.
