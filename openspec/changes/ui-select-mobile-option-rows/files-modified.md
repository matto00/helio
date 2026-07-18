# Files modified — HEL-308

- `frontend/src/shared/ui/inputs.css` — appended a `@media (max-width: 768px)` block lifting `.ui-select__option` to `min-height: 44px` with `display: flex; align-items: center` (block → flex so the label stays centered). Desktop untouched.
- `frontend/src/shared/chrome/ActionsMenu.css` — same mobile media block lifting `.actions-menu__item` to `min-height: 44px` with flex centering. Desktop untouched.
- `frontend/src/shared/ui/inputs.css.test.ts` — new CSS-lock test (PanelDetailModal.css.test.ts helper precedent): asserts the `max-width: 768px` block gives `.ui-select__option` `min-height: 44px` + flex centering.
- `frontend/src/shared/chrome/ActionsMenu.css.test.ts` — new CSS-lock test: same guard for `.actions-menu__item`.

## Root cause (systematic-debugging Iron Law)

- **Root cause:** presentation/CSS layer — `.ui-select__option` and `.actions-menu__item` size purely from padding (`--space-2`/`--space-3`) plus font line-height (`--text-sm`/`--text-xs`) with no `min-height` floor, and neither `inputs.css` nor `ActionsMenu.css` carried any `@media` query, so on phone the rows compute below the 44px HIG minimum.
- **Probe:** static token computation from `frontend/src/theme/theme.css` (dev servers not running; the skeptic already confirmed the heights empirically at the design gate). `--space-2` = 8px, `--text-sm` = 14px, `--text-xs` = 12px, `line-height: 1.4`.
- **Probe output:** `.ui-select__option` = 8 + (14 × 1.4 ≈ 19.6) + 8 ≈ **35.6px**; `.actions-menu__item` = 8 + ~15 + 8 ≈ **31px** — both under 44px, matching the skeptic's empirical ~34px/~31px. The fix adds `min-height: 44px` inside a `max-width: 768px` block, so mobile rows clear 44px and desktop is unchanged by construction.
