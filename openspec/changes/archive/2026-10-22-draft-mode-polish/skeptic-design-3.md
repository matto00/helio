## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9 (branch bug/draft-mode-polish/HEL-1685; the change dir is untracked).
Paths are relative to `frontend/src/features/pipelines` unless stated otherwise.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/draft-mode-polish/HEL-1685`.
- **Round-2 CR1 (D8): resolved.**
  - design.md:75-82 now says "Every function prop of the three dialogs goes through `useLatestCallback`". It names all four unstable props: the Share and Schedule `onClose`, StepPalette `onClose` (`useSpineStepActions.tsx:207`) and `onSelect`.
  - Checked against the tree:
    - `useSpineStepActions.tsx:207` is `onClose={() => setPalette(null)}`.
    - `StepPaletteProps` (`StepPalette.tsx:23-27`) is exactly `open`, `onClose` and `onSelect`. With both callbacks stable, `memo` can hold.
    - Share and Schedule take `pipelineId`/`pipelineName`/`schedule`/`open` plus `onClose` (`PipelineDetailDialogs.tsx:58-73`).
  - Task 2.1 matches ("all 4 dialog function props").
  - The test now renders the real `PipelineDetailPage` through `usePipelineDetailPage`. That settles round 2's non-blocking note about the hand-built `page` prop.
  - The Modal titles are distinct ("Add step", `Share "…"`, "Set/Edit schedule"), so counting renders by title works.
  - `useLatestCallback` is assigned in `useLayoutEffect` and must never be called during render. That is safe here: round 2 established that `onSelect`/`onClose` are called only from event handlers and Modal's cancel effect.
- **Round-2 CR2 (D5): resolved.** design.md:52-56 now asserts on the ERRORED step 2: saved 5, draft 3, then an error.
  - Checked against `state/draftStepView.ts`:
    - A client `error` node maps to `stale(lastGood)`, which carries the last good count AND rows (:79-83, :102).
    - The tracker records a good frame only for `ok`, non-`frameStale` views (:187-189). After edit 1, the lifted tracker therefore holds step 2 = 3 plus the draft rows.
    - A fresh tracker seeds from the base walk (:174-178) and shows 5 plus the saved rows.
  - So the test is a real red on main, and it asserts the rows as well.
  - The flip uses `matchMedia`, which is what `useIsPhoneShell` reads (`app/shell/useIsPhoneShell.ts:9-10`).
  - Task 1.5 matches.
- **Round-2 CR3 (D10): resolved.** design.md:94-105 says settling is computed in the outer `LiveOutputColumn` (:54, which holds both `fresh` and `coalesced`) and reaches the memoised view as a boolean `settling` prop. The fresh presentation is never passed in.
  - `pick` (:95) is lifted, and its setter is stable.
  - `resolveDisplayedOutput` is extracted from :96-103 and is pure.
  - The comparison uses `view.rows` reference and `view.status`. Both come from memoised walks (`usePipelineDraftFrames.ts:123-129`, `views` memo).
  - Cost reasoning checked: the view re-renders when `settling` flips to true while its coalesced props are unchanged. Its `model` memo (:142-145) is then unchanged, so the memoised `LiveOutputBody` is skipped. The coalesced commit and the flip back to false happen in the same outer render. Test (3) asserts this with a render count.
  - D10 has been added to the hot-path risk (design.md:143).
  - Task 2.3 matches.
- **Round-1 non-blocking notes now in the text:**
  - D2 scrolls to the end of the Output list (:25-26).
  - D6 acknowledges the `stepSaveErrors` seam (:59-60).
  - D11 asserts that `performance.now` advances under fake timers (:110-111). `useIdleCoalesced.ts:35` uses `performance.now`.
  - D13 places the fix in ChartPanel's `noAnimation` memo (`ChartPanel.tsx:125-132`) and adds a signature unit test (:117-121).
- **Nothing substantive was lost in the reflow.** There is no persisted round-2 `design.md` (the evidence dir holds only ticket.md, premise-validation.md and skeptic-design-1/2.md). So I checked every decision that round 1 and round 2 verified, quoted or required, against the current text:
  - D1: the 4-row grid and slot, with the e2e gap check.
  - D3: the `clearAuth` listener, the stated cost of a network failure at load, and the store test plus the 401 test. The false "first 401 after sign-in" sentence is still absent.
  - D4: the probe comes first, with a not-reproducible exit.
  - D6: the removal, and the guard-vs-red labelling.
  - D7: the cumulative seen set, with the base→minus→base red.
  - D9: no `impact.hints` rendered at all, with all 4 backend hints listed.
  - D11–D17 are all present.
  - The Planner Notes and the three Risks are intact.
  - Every ticket item is still covered: 1–2 D16/D17, 3 D8, 4–10 D1–D7, 11 D9, 12/14 D16, 13 deferred, A–J as in round 2.
  - The spec deltas carry the "Session expired before a reload", "Desktop to phone mid-error" (narrowed to client-evaluated steps), "Settling after an edit" and "Unrelated re-render" scenarios.
- **Spot-checked tree citations:**
  - `PipelineSpineLayout.css:5` (3 rows)
  - `laneLayout.ts:156` ("an unknown step")
  - `MobilePipelineActions.tsx:50` (`data-slot="draft-status"`)
  - `warmListeners.ts:204-211`
  - `toBe(151)` in both token guards
  - `PipelineSpineLayout.tsx:69-70` and `PipelineMobileLayout.tsx:61-62` (inline arrows)
  - `useStepSelection.ts:58-70` (previous-list diff)
  - All match.

### Verdict: CONFIRM

### Non-blocking notes

- **D10:** compare the fresh node view against the **shown** bundle's, not the raw `coalesced` one. When the selected step changes, `shown = fresh` (`LiveOutputColumn.tsx:64`), so the view already draws the fresh frame. But `coalesced` still lags. `draftWalk` depends on `focusStepId` (`usePipelineDraftFrames.ts:118`), so comparing against `coalesced` could show "updating" for one settle window after every step selection. Comparing against `shown` gives false in that case. A test case for a step selection would pin it.
- **D8 citation:** `PipelineDetailDialogs.tsx:58,68` points at the component openings. The inline `onClose` arrows are at :62 and :72.
- **Task 2.6 vs D13:** the task says "a unit test on referenceMarksOption", but D13 puts the fix in ChartPanel's `noAnimation` memo. A test on `referenceMarksOption` alone would not exercise ChartPanel. Follow D13: test the ChartPanel option output (the marks have `animation:false` under `noAnimation`), plus the `chartShapeSignature` invariance test.
- **D3:** the expire → reload case is covered by the `clearAuth` store test, because `rehydrateAuth`'s catch dispatches `clearAuth`. Saying so in evidence.md would make that coverage explicit.
