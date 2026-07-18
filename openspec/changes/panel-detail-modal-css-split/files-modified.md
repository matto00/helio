# Files modified — panel-detail-modal-css-split (HEL-309)

- `frontend/src/features/panels/ui/PanelDetailModal.css` — reduced to shell/chrome only (dialog, backdrop, inner, header, title, close, unsaved badge, header actions, edit button, view body, edit-section headings, discard warning, footer + Save/Cancel buttons); exact-token spacing migration applied; all three `@media` blocks removed (moved to `.mobile.css`).
- `frontend/src/features/panels/ui/PanelDetailModal.binding.css` — new; content/row/field/slider + data tab (type search/list/selected-type, mapping rows, bind/literal mode toggle).
- `frontend/src/features/panels/ui/PanelDetailModal.sections.css` — new; per-kind config editors (collection segmented control, table display columns/reorder/reset, chart display toggle rows/hints).
- `frontend/src/features/panels/ui/PanelDetailModal.appearance.css` — new; chart appearance, chart-type selector, markdown/text content textarea, image-upload control.
- `frontend/src/features/panels/ui/PanelDetailModal.mobile.css` — new; all three `@media` blocks consolidated (both `max-width: 430px` blocks + the single `max-width: 768px` ≥44px tap-target block kept as ONE contiguous block); loaded last so overrides win at their breakpoints.
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — style-import wiring only: added sibling imports in exact cascade order (shell → binding → sections → appearance → mobile last). No component logic change.
- `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` — `CSS_PATH` retargeted to `PanelDetailModal.mobile.css` (the file now holding the `max-width: 768px` block). No assertion weakened.

## Behavior-preservation evidence

Computed equivalence proof (`scratchpad/equiv.py`): resolving every `--space-*` token
back to its px value and normalizing whitespace/comments, the original single file and
the concatenation of the five new files (in import order) contain the SAME 119 top-level
rules with byte-identical declaration bodies — 0 rules only-in-original, 0 only-in-new.
This exhaustively proves pixel-identity for a token-value-equality refactor.
