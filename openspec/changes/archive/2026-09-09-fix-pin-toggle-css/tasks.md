## 1. Apply the two CSS fixes

- [x] 1.1 In `frontend/src/shared/ui/SortableTh.tsx`, add a class (`sortable-th__label`) to the
      existing unclassed `<span>{children}</span>` label wrapper (design.md D1).
- [x] 1.2 In `frontend/src/shared/ui/DataGrid.css`, add, scoped per-density exactly like the existing
      `--pin-reserve` padding rules (`.ui-data-grid--<density> .ui-data-grid__table thead
      th.ui-data-grid__th--pin-reserve .sortable-th__btn`, design.md D7): `min-width: 0` on the
      button, and on its `.sortable-th__label` child: `max-width: 100%; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; min-width: 0` (design.md D1/D2 — no
      `calc(100% - var(--space-9))`; rely on the existing `<th>` padding-right reservation, do not
      stack a second one). Keep the existing `.ui-data-grid__th--pin-reserve` padding-right rules
      unchanged.
- [x] 1.3 In the same file, change `.ui-data-grid__table thead th { min-height: 48px }` (inside the
      `@media (max-width: 430px), (pointer: coarse)` block) to `height: 48px`. Do not add a new
      breakpoint. Do not touch `.ui-data-grid__pin-toggle-btn`'s 44px floor.

## 2. Prove the fixes are real (red-before-green)

- [x] 2.1 Before finalizing 1.1-1.3, write the new Playwright geometry assertions (task group 3)
      and run them against the pre-fix worktree state via a **path-scoped** stash (design.md D6):
      `git stash push -- frontend/src/shared/ui/DataGrid.css frontend/src/shared/ui/SortableTh.tsx`,
      run the spec, confirm it fails, `git stash pop`.
- [x] 2.2 Re-run the same spec against the fixed tree and confirm it passes.

## 3. Add Playwright geometry coverage

- [x] 3.1 Add `e2e/hel1065-pin-toggle-css-fixes.spec.ts`. Reuse the `e2e/hel910-pipeline-to
      -dashboard-flow.spec.ts` register-then-API-seed pattern (data source → pipeline → output →
      Table panel) for a fresh account, choosing/generating column data so at least one column
      label genuinely truncates at the panel's rendered width. Pin ≥3 leading columns via the
      pin-toggle UI control itself (design.md D5).
- [x] 3.2 Assert `labelUnderPinIcon === 0` (rendered bounding-box overlap between the truncating
      label and the pin icon) with columns pinned, in both light and dark themes. Assert the
      truncating header's `scrollWidth > clientWidth` as an explicit precondition before this check
      (skeptic-design-2.md non-blocking note), so fixture drift that stops truncation cannot make
      the overlap assertion silently vacuous again.
- [x] 3.3 In a context/page resized to a real ≤430px viewport with coarse-pointer emulation (reuse
      `e2e/support/touchTargetProbe.ts`'s `measureBox` helper, matching
      `e2e/hel813-mobile-touch-target-floor.spec.ts`'s existing pattern), assert the pin-toggle
      button's box and its computed focus-ring extent (`rect ± outline-offset ± outline-width`) are
      both fully inside their containing `<th>`, and the control is still ≥44×44px, in both themes.
- [x] 3.4 Include a desktop/fine-pointer control assertion confirming the header row height is
      unaffected outside the coarse-pointer/≤430px media query (design.md scenario "Desktop/mouse
      viewport is unaffected").

## 4. Retire only the row-height value assertion; keep the co-location and reservation guards

- [x] 4.1 In `frontend/src/shared/ui/DataGrid.test.tsx`, KEEP the `padding-right` calc-value
      assertion (~line 1493) unchanged — it is the only automated guard on the 48px reservation the
      label fix now depends on (design.md D4 correction). In the `min-height: 48px` STATIC SOURCE
      test (~lines 1520-1538), update ONLY the row-height regex to match `height:\s*48px` instead of
      deleting the test — retain its `.ui-data-grid__pin-toggle-btn { min-height: 44px }`
      same-media-query co-location assertion unchanged. Add a short comment pointing at the new e2e
      spec for rendered-effect coverage.

## 5. Verify

- [x] 5.1 `npm run lint`, `npm run typecheck`, `npm test -- --testPathPatterns=DataGrid` from
      `frontend/`.
- [x] 5.2 Run the new e2e spec against the local dev server, both themes.
- [x] 5.3 Confirm AC3 (persistence) remains explicitly out of scope — no cycle spent on it.
