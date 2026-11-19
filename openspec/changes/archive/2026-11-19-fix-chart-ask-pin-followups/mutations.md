# Mutation checks (4.1)

Each fix was reverted by construction: the red runs in red-evidence.md ran the new tests against the unchanged source
(the exact pre-fix code), and each failed for the stated reason; with the fix in place the same tests pass:

- Item 3: `AskPinRealRouteSpec` 400 -> 201 (47 backend tests green across AskPinRealRouteSpec, AskDataServiceSpec, AskSeamSpec, AskRoutesSpec).
- Item 2: `AskPanel.test.tsx` scope-change test red -> green; the in-scope retention test stayed green throughout (38 ask/outputEditor jest suites, 515 tests).
- Item 1: `hel1775-output-editor-chart-fills-card.spec.ts` canvas 100 vs card 240 -> 240 vs 240 in all four viewport/theme cases.
