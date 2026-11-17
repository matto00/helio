## Standing Constraints

## 1. Probe (confirm before changing)

- [x] 1.1 Re-confirm the probe on unchanged code (last dashboard-list row, 1280x400): record panel rect, innerHeight, last item `elementFromPoint` result in files-modified.md
- [x] 1.2 Write the e2e (task 3.1) and run it against unchanged code; record the red for BOTH cases in files-modified.md

### Frontend

## 2. Shared fit

- [x] 2.1 Generalise `shared/ui/selectPanelFit.ts` into a side-parameterised fit helper with Select's exact rule (design D2) and the no-layout rule; `fitSelectPanel` becomes a wrapper; `selectPanelFit.test.ts` green unmodified
- [x] 2.2 Unit-test the helper: prefer fits, flip when other side roomier, capped, no-layout input, both prefer sides; `npm --prefix frontend test -- --testPathPatterns=PanelFit`
- [x] 2.3 ActionsMenu: pass `place` (top-or-bottom anchor per D2a, maxHeight, right clamped ≥ 8px from left); render `visibility: placed ? undefined : "hidden"` and `maxHeight` inline; `overflow-y: auto` on `.actions-menu__panel`; rewrite the `align` doc comment
- [x] 2.4 ActionsMenu tests: HEL-719 `align` tests (`ActionsMenu.test.tsx` ~139-156) pass UNMODIFIED; add unit assertions that the panel is `visibility: hidden` before placement, that a left-edge trigger in a 390px viewport yields left ≥ 8, and that a short-viewport trigger flips/caps (mocked rects); each new test shown red against unfixed code per design D9
- [x] 2.5 ActionsMenu: move first-item focus to run once `placed`; existing keyboard tests pass unmodified; add the falsifiable focus test per design D9

### Tests

## 3. Verification

- [x] 3.1 `e2e/hel1750-actions-menu-viewport-fit.spec.ts` per design D8: desktop (mouse) rail last row at 1280x400 and phone step-sheet "Step actions" menu at 390x300 (SpineOutputs cannot breach, see design D8); last item in viewport and hit at its centre after animations settle, then clicked; exact-id teardown; red first, green after
- [x] 3.2 Call-site audit of all 13 ActionsMenu users with the live spot probes named in design D7 plus an in-dialog site; record that the phone dashboard list (Share button only) and phone panel cards have no ⋮; table in files-modified.md
- [x] 3.3 Visual check against the running app: light and dark, desktop and phone, menu below/flipped/capped; screenshots in .concertino/scratch/HEL-1750/
- [x] 3.4 Gates: lint, typecheck, format:check, jest (maxWorkers 3); delete any dev-DB residue by exact id
