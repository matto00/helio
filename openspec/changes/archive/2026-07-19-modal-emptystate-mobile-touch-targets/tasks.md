## 1. Frontend

- [x] 1.1 Add a `@media (max-width: 768px)` block in `frontend/src/shared/ui/Modal.css` with a
      `.ui-modal__close { min-width: 44px; min-height: 44px; }` rule and an explanatory comment matching
      the HEL-308/314 convention; keep the glyph centered
- [x] 1.2 In the same mobile block in `Modal.css`, add `.ui-modal-btn { min-height: 44px; }`, leaving
      desktop `--control-md` height untouched
- [x] 1.3 Add a `@media (max-width: 768px)` block in `frontend/src/shared/ui/EmptyState.css` with
      `.ui-empty-state__cta { min-height: 44px; }` and an explanatory comment (base selector floors the
      sidebar variant defensively)

## 2. Tests

- [x] 2.1 Add `frontend/src/shared/ui/Modal.css.test.ts` (reusing the `inputs.css.test.ts`
      `findMediaBlock`/`findRuleBody` helpers) with CSS-lock cases asserting the mobile block keeps
      `min-width: 44px` + `min-height: 44px` for `.ui-modal__close` and `min-height: 44px` for
      `.ui-modal-btn`
- [x] 2.2 Add `frontend/src/shared/ui/EmptyState.css.test.ts` with a CSS-lock case asserting the mobile
      block keeps `min-height: 44px` for `.ui-empty-state__cta`

## 3. Verification

- [x] 3.1 Run `npm test`, `npm run lint`, and `npm run format:check`; all pass
- [x] 3.2 Verify at 390×844 (both themes) on a bottom-nav create/empty-state route that
      `.ui-modal__close`, `.ui-modal-btn`, and `.ui-empty-state__cta` measure ≥44px via
      `getBoundingClientRect`, desktop (>768px) is unchanged, and no modal header/footer or empty-state
      layout is visually broken
