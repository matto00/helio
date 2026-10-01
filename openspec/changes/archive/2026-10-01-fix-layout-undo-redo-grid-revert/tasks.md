## 1. Fix

- [x] 1.1 Pending-commit flag: stop handlers set it, `handleLayoutChange` commits to the store (design Decision 1)
- [x] 1.2 `useLayoutSave.ts` + `layoutHistorySlice` revision counter: re-baseline by default, skip only for the
  interaction commit and undo/redo; persisted ref set on PATCH fulfilled (design Decision 2)
- [x] 1.3 Verify callback order and flag clearing timing in a real browser

- [x] 1.4 Implementation notes from design-gate round 3: both skip branches must still set `latestLayoutRef` to the
  resolved layout; clear `localCommitRef` once consumed; add a test for drag then panel create before flush (the
  create re-baselines, so the drag is visible but unsaved; either keep it dirty or document and test the choice)

## 2. Tests

- [x] 2.1 Unit tests: stop commits to the store; drag then flush sends exactly one PATCH with the dragged layout;
  stop-before-change ordering; sequences drag/undo/redo/flush and drag/undo/flush; no-move drag; flag does not leak; panel create/delete/refetch change causes no PATCH and no pending
- [x] 2.2 Playwright `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts`: drag and resize, undo/redo by keyboard
  and CommandBar buttons, lg and sm widths, light and dark themes; assert rendered boundingBox
- [x] 2.3 Run the spec against main (unfixed) and record it red, then green on the fix
- [x] 2.4 Clean up any seeded users/dashboards by exact id

## 3. Gates

- [x] 3.1 `npm run lint`, `npm run typecheck`, `npm test` (frontend); show known flakes pass in isolation
- [x] 3.2 File follow-up for undo/redo persistence and the stuck pending flag

## Standing Constraints
