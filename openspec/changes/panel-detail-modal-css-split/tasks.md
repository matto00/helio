## 1. Baseline

- [x] 1.1 Capture before screenshots of the panel-detail modal at desktop and 390×844 in BOTH
      themes (light+dark), across representative kinds (metric/chart/table/collection/markdown),
      to the session scratchpad or a gitignored tmp dir — never the repo root.
- [x] 1.2 Enumerate every literal spacing declaration (margin/padding/gap/inset/row-gap/
      column-gap) in PanelDetailModal.css and mark which have an EXACT `--space-*` token
      (4/8/12/16/20/24/32/40/48/64) vs. which must stay literal (6/10/14/44px, borders, etc.).

## 2. Token migration (behavior-preserving, in place)

- [x] 2.1 Replace each exactly-equal literal spacing value with its `--space-*` token
      (4/8/12/16/20/24/32/40/48/64px). For SHORTHAND declarations, tokenize PER-COMPONENT —
      each exact-equal component becomes its token, non-exact components stay literal (e.g.
      `padding: 8px 12px` → `var(--space-2) var(--space-3)`; `padding: 8px 4px` → `var(--space-2)
      var(--space-1)`; `padding: 7px 10px` stays fully literal). Do NOT migrate widths/heights/
      min-height/min-width (incl. all 44px tap targets), border widths, or no-exact-token values
      (2/5/6/7/10/14/18px stay literal).
- [x] 2.2 Run `npm test -- --testPathPattern=PanelDetailModal.css` — all CSS-lock tests still
      pass with the file still single (token pass must not touch the 44px literals).

## 3. File split along section structure (5 files, TSX-import wiring)

- [x] 3.1 Carve the binding + data-tab rules into `PanelDetailModal.binding.css` (content/row/
      field/slider, type search/list/selected-type, mapping rows, bind/literal mode toggle).
- [x] 3.2 Carve the per-kind config editors into `PanelDetailModal.sections.css` (collection
      segmented, table display columns/reorder/reset, chart display controls).
- [x] 3.3 Carve chart appearance, chart-type selector, `.panel-detail-modal__markdown-textarea`
      (markdown/text content), and the image-upload control into `PanelDetailModal.appearance.css`.
- [x] 3.4 Move ALL THREE `@media` blocks (both `max-width: 430px` and the `max-width: 768px`
      ≥44px block) into `PanelDetailModal.mobile.css`, preserving exact within-block source order
      and keeping the 768px ≥44px overrides as ONE contiguous `@media` block.
- [x] 3.5 Retain `PanelDetailModal.css` as the shell/chrome file (dialog/backdrop/inner,
      header/close/unsaved-badge/header-actions/edit-btn, view body, edit-section headings,
      discard warning, footer + Save/Cancel buttons). Do NOT use a CSS `@import` barrel.
- [x] 3.6 Wire the split via `PanelDetailModal.tsx` style imports in exact cascade order: shell
      (`.css`) first, then binding, sections, appearance, then mobile LAST. No other TSX change.
- [x] 3.7 Confirm each resulting file is comfortably under the ~400-line soft budget (`wc -l`).

## 4. Test-lock retarget

- [x] 4.1 Repoint `PanelDetailModal.css.test.ts` `CSS_PATH` to the file that now holds the
      `max-width: 768px` block (`PanelDetailModal.mobile.css`). Do NOT weaken any assertion.
- [x] 4.2 Confirm the suite still executes ALL locked cases (not zero) and passes.

## 5. Verification

- [x] 5.1 `npm run lint` (zero warnings), `npm run format:check`, `npm test` (full frontend
      suite), `npm run build`.
- [x] 5.2 Capture after screenshots at the same viewports/themes/kinds; pixel-diff against the
      baseline — the diff MUST be visually identical. Note any intentionally-retained literals.
