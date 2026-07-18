## 1. Frontend

- [x] 1.1 Probe (Iron Law): static token computation (dev servers not running per brief). `.ui-select__option` = padding 8+8 + `--text-sm` 14px×1.4 ≈ 35.6px; `.actions-menu__item` = padding 8+8 + `--text-xs` 12px ≈ 31px — both under 44px, matching the skeptic's empirical ~34px/~31px at design gate
- [x] 1.2 Append `@media (max-width: 768px)` block to `frontend/src/shared/ui/inputs.css`: `.ui-select__option { min-height: 44px; display: flex; align-items: center; }` with a comment citing the 44px HIG minimum (MobileNavSheet.css precedent)
- [x] 1.3 Append `@media (max-width: 768px)` block to `frontend/src/shared/chrome/ActionsMenu.css`: `.actions-menu__item { min-height: 44px; display: flex; align-items: center; }` with the same comment style
- [~] 1.4 Verify at 390×844 (both themes): option rows and menu items ≥44px via getBoundingClientRect; verify desktop (e.g. 1280px) heights unchanged from the 1.1 probe baseline — DEFERRED to evaluator/skeptic per orchestrator brief (empirical browser measurement is their gate). Executor coverage: static probe (1.1) + CSS-lock tests (2.1/2.2); desktop unchanged by construction (rules live only inside the `max-width: 768px` media block)
- [~] 1.5 Verify representative `ui-select` call sites at 390×844 (panel-detail field select, pipeline editor select, panel-creation type select): labels centered, long lists scroll within the panel, no horizontal overflow; verify a bottom-of-screen panel-card kebab menu stays on-screen — DEFERRED to evaluator/skeptic per orchestrator brief

## 2. Tests

- [x] 2.1 Add `frontend/src/shared/ui/inputs.css.test.ts` (PanelDetailModal.css.test.ts helper pattern): mobile media block exists at `max-width: 768px` and `.ui-select__option` body has `min-height: 44px`
- [x] 2.2 Add `frontend/src/shared/chrome/ActionsMenu.css.test.ts`: same lock for `.actions-menu__item`
- [x] 2.3 Run gates: `npm test`, `npm run lint`, `npm run format:check` (frontend); commit
