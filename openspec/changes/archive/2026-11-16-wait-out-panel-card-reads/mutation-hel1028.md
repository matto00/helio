# HEL-1723 hel1028:310 mutation proof

Mutation (product code, temporary, reverted before commit): in `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`,
after the real card's `<h3 className="panel-grid-card__title">`, add `<span className="panel-grid-card__handle" />`.
Served live by this lane's Vite server (DEV_PORT 7155), so every real phone card carries a handle.

Pinned command (no "DEV_PORT is unset" warning in either transcript):
`DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 npx playwright test e2e/hel1028-layout-undo-redo-visual-revert.spec.ts -g "xs: a container" --workers=2 --trace retain-on-failure`

## NEW spec (waits `waitForPanelStack(page, 2)` first), mutated: RED, nonzero received count (C2)
```
  ✘  1 [dev] › e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:298:7 › ... xs: a container under 768px renders the mobile stack with no RGL grid to revert (8.6s)
    Error: expect(locator).toHaveCount(expected) failed
    Locator:  locator('.panel-grid-card__handle')
    Expected: 0
    Received: 2
        9 × locator resolved to 2 elements
          - unexpected value "2"
      313 |       await waitForPanelStack(page, 2);
    > 314 |       await expect(page.locator(".panel-grid-card__handle")).toHaveCount(0);
  1 failed
exit=1
```
It fails on the handle-count assertion (line 314), after the wait passed, with Received: 2 (the mutated module was served).

## OLD spec (HEAD version, no wait), same mutation: GREEN (the vacuity, demonstrated)
```
  ✓  1 [dev] › e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:297:7 › ... xs: a container under 768px renders the mobile stack with no RGL grid to revert (2.9s)
  1 passed (3.4s)
exit=0
```
The old assertion passes while two handles are on the page, because it counts before anything has mounted.

## Un-mutated NEW spec: GREEN
Part of the `--repeat-each 3` run of hel1028 + hel1681 recorded in sweep.md: `84 passed (3.7m)`, exit 0.

## Revert
`git checkout frontend/src/features/panels/ui/grid/MobilePanelStack.tsx`; `git diff --stat -- frontend backend` prints nothing.
