## Why

`frontend/src/features/panels/ui/PanelDetailModal.css` has grown to 1045 lines (soft budget
~400) and carries dozens of literal `px` spacing values where DESIGN.md `--space-*` tokens
exist. It is the most-churned file of the v1.5 phase (HEL-245/255/248/303/307/308 all touched
it) and is the last unaddressed piece of accumulated styling debt. Consolidating tokens and
splitting the file makes future panel-config work legible and keeps it inside the design system.

## What Changes

- Migrate literal spacing values (margin/padding/gap and equivalents) to DESIGN.md `--space-*`
  tokens **only where the token value is exactly equal** to the literal. Literals with no exact
  token, and small optical tweaks ≤4px, stay literal (noted).
- Split `PanelDetailModal.css` along the modal's section structure into five sibling CSS files,
  each comfortably under the ~400-line soft budget (shell/chrome, binding + data editor, per-kind
  config editors, chart-appearance/content/image, mobile overrides).
- Keep all mobile `@media (max-width: 768px)` ≥44px tap-target overrides consolidated in ONE
  `@media` block in ONE file, and repoint `PanelDetailModal.css.test.ts`'s `CSS_PATH` at that
  file. Assertions are unchanged — the locks are not weakened.
- Wire the new files via sibling style imports in `PanelDetailModal.tsx` in exact cascade order
  (shell first, mobile last) — import-path wiring only, no component logic change. A CSS
  `@import` barrel is not used (it cannot preserve base-before-override cascade order).

This is a **behavior-preserving structural refactor**: no visual change beyond exact token
equivalents, no component/TSX logic change.

## Non-goals

- No visual redesign, no rounding literals to "close enough" tokens, no new tokens.
- No changes to `BoundOrLiteralField`, `DataTypePicker`, or any component logic.
- No changes to the `.css.test.ts` assertions themselves (only the file target may move).

## Capabilities

### New Capabilities
- `panel-detail-modal-css-structure`: structural/quality invariants this change establishes and
  the CSS-lock tests enforce — file-size budget, exact-token spacing usage, behavior-preservation
  and the mobile ≥44px tap-target locks. Analogous to the existing `backend-file-size-compliance`
  capability. No product-behavior/contract change.

### Modified Capabilities
- (none) — pure refactor; no existing spec's requirements change.

## Impact

- `frontend/src/features/panels/ui/PanelDetailModal.css` (split into siblings).
- `frontend/src/features/panels/ui/PanelDetailModal.css.test.ts` (CSS_PATH retarget only).
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` (style-import wiring only, if used).
- No backend, no API, no schema, no dependency changes.
