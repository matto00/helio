## 1. Frontend

- [x] 1.1 Add a `min-width: 44px; min-height: 44px` rule for `.actions-menu__trigger` inside the
      `@media (max-width: 768px)` block in `frontend/src/shared/chrome/ActionsMenu.css`, with an
      explanatory comment matching the HEL-308 convention; keep the dots glyph centered
- [x] 1.2 Add a `min-height: 44px` rule for `.ui-select__trigger` inside a `@media (max-width: 768px)`
      block in `frontend/src/shared/ui/inputs.css` (leaving `.panel-detail-modal`-scoped overrides
      untouched), with an explanatory comment

## 2. Tests

- [x] 2.1 Extend `frontend/src/shared/chrome/ActionsMenu.css.test.ts` with a CSS-lock case asserting
      the mobile block keeps `min-width: 44px` and `min-height: 44px` for `.actions-menu__trigger`
- [x] 2.2 Extend `frontend/src/shared/ui/inputs.css.test.ts` with a CSS-lock case asserting the mobile
      block keeps `min-height: 44px` for `.ui-select__trigger`

## 3. Verification

- [x] 3.1 Run `npm test`, `npm run lint`, and `npm run format:check`; all pass
- [x] 3.2 Verify at 390×844 (both themes) that `.actions-menu__trigger` and bare `.ui-select__trigger`
      measure ≥44px via `getBoundingClientRect`, desktop (>768px) is unchanged, and no host header/card
      row is visually broken by the taller kebab
- [x] 3.3 Re-audit shared interactive controls in the mobile shell / shared components and record a
      final audit note in the change asserting no remaining sub-44px controls
