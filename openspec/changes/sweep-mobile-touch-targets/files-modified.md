# Files modified — HEL-314

## Source

- `frontend/src/shared/chrome/ActionsMenu.css` — added `.actions-menu__trigger { min-width: 44px; min-height: 44px }` inside the existing `@media (max-width: 768px)` block (centering inherited from co-applied `.popover__trigger`); desktop `--control-sm` unchanged.
- `frontend/src/shared/chrome/ActionsMenu.css.test.ts` — CSS-lock case asserting the mobile block keeps `min-width`/`min-height: 44px` for `.actions-menu__trigger`.
- `frontend/src/shared/ui/inputs.css` — added `.ui-select__trigger { min-height: 44px }` inside the existing `@media (max-width: 768px)` block; `.panel-detail-modal`-scoped override untouched; desktop `--control-md` unchanged.
- `frontend/src/shared/ui/inputs.css.test.ts` — CSS-lock case asserting the mobile block keeps `min-height: 44px` for `.ui-select__trigger`.

## Change artifacts

- `openspec/changes/sweep-mobile-touch-targets/tasks.md` — all tasks marked complete.
- `openspec/changes/sweep-mobile-touch-targets/audit.md` — task 3.3 final tap-target audit (enumerates inspected controls; flags shared `Modal`/`EmptyState` remainders as spinoff candidates).
