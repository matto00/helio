# Tasks: fix-legacy-divider-fallback

## 1. Probe (Iron Law: systematic-debugging)

### Frontend

- [x] 1.1 Probe-confirm the bug: render a divider panel with `dividerColor` unset (seed or PATCH via API) and capture evidence of invisibility (computed background-color invalid/empty; screenshot to scratchpad)

## 2. Fix

### Frontend

- [x] 2.1 Change the fallback in `frontend/src/features/panels/ui/DividerPanel.tsx` from `var(--color-border)` to `var(--app-border-subtle)`
- [x] 2.2 Grep-verify no remaining `--color-border` references in `frontend/src` (source or tests)

## 3. Tests

### Tests

- [x] 3.1 Update `frontend/src/features/panels/ui/DividerPanel.test.tsx` default-color assertion to `var(--app-border-subtle)`
- [x] 3.2 Ensure an explicit-color case exists asserting the passed `dividerColor` is used verbatim (no-regression criterion)

## 4. Verify (Iron Law: verification-before-completion)

### Tests

- [x] 4.1 Verify the fix in the running app: colorless divider visible in light AND dark themes; explicit-color divider unchanged (screenshots to scratchpad)
- [x] 4.2 Mobile check at 390×844 (both themes) since panel rendering is touched
- [x] 4.3 Run gates: `npm test`, `npm run lint`, `npm run format:check`, `npm run build`
