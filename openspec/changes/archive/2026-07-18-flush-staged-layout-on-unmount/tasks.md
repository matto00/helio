## 1. Probe (Iron Law: systematic-debugging)

- [x] 1.1 Probe-confirm the drop: stage a layout change on desktop, shrink below 768px within the flush window, confirm no layout PATCH fires and the change is lost (test-level or live probe; record evidence)

### Frontend

## 2. Fix

- [x] 2.1 Add latest-ref for `persistLayout` in `useLayoutSave` and a dedicated unmount-only effect that flushes it (design D2)
- [x] 2.2 Update `useLayoutSave` / `DesktopPanelGrid` / `usePanelUpdatesFlush` header comments to document the unmount flush and why it preserves the HEL-301 structural guarantee

### Tests

## 3. Regression tests (PanelGrid.test.tsx or sibling)

- [x] 3.1 Shrink-mid-edit: staged layout change flushes exactly one PATCH with the staged layout on crossing below 768px
- [x] 3.2 Browse-only crossing: no staged change → zero layout PATCHes from the unmount path
- [x] 3.3 Rapid repeated crossings: staged change persists exactly once; no PATCH originates while the mobile stack is mounted
- [x] 3.4 Re-run existing HEL-301 xs byte-identity + structural no-persist guards and HEL-304 flush tests unmodified — all pass

## 4. Repro-widening audit

- [x] 4.1 Re-verify column widths (HEL-304 audit): confirm they flow through `accumulatePanelUpdate` → `usePanelUpdatesFlush` and are unaffected by the shell swap; note evidence in files-modified.md
- [x] 4.2 Audit for any other unmount-with-staged-state consumers of `useLayoutSave` staging (e.g. navigation away from dashboard route) — confirm the unmount flush covers them

## 5. Gates

- [x] 5.1 `npm run lint`, `npm run format:check`, `npm test` all green in the worktree
