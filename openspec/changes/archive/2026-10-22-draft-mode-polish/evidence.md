# Evidence — HEL-1685 draft-mode-polish

Jest runs: `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npx jest --testPathPatterns=<name>` from `frontend/`.

## Item 6 (D3) — kept drafts cleared on session expiry
Test: `frontend/src/features/pipelines/state/keptDraftListeners.test.ts` (real store, plus the real 401 interceptor).
RED (before the listener existed): `Tests: 2 failed, 2 total` — both `expect(sessionStorage.getItem("helio.pipelineDraft.p1")).toBeNull()` received the stored JSON.
GREEN (after `registerKeptDraftClearListener` in `store.ts`): `Tests: 2 passed, 2 total`.
Expire-then-reload: a failed `rehydrateAuth` dispatches `clearAuth`, which the same listener handles.

## Item 10 (D7) — restored step is not "added"
Feed: `useAddedStepId` is fed the page's `steps` (the draft-overlaid list), so a Discard that restores a deleted step is a list change that re-adds the id.
Test: `hooks/useStepSelection.test.tsx` "does not treat a step that comes back ... as created".
RED on unfixed code: `Expected: "b"  Received: "c"` (`Tests: 1 failed, 11 passed, 12 total`).
GREEN after the cumulative seen-ids set: all pass. A second test keeps "an id never seen before is still selected".

## Item 9 (D6) — dead saveError plumbing removed
Removed `saveError`/`saveErrorIsValidation` from `useStepCardEditorState`, `useStepCardState`, `stepCardStateTypes`, `StepOpEditor` and the configs (Cast, Pivot, Window, FillNull, Join, Lookup, Union, UpsertSource, SecondaryInputPicker) plus the props' tests. `npx tsc --noEmit` clean; `grep -rn saveErrorIsValidation frontend/src` empty.
The live path is unchanged: `PipelineDetailPage.draftMode.test.tsx` "a validation failure (400) keeps the draft and names the step the server named" already exists on main and passes — it is a GUARD (not a red); the 400-naming path was never plumbed through `saveError`, so no mutation of it applies here.

## Item 8 (D5) — frames survive a desktop-to-phone switch
Test: `ui/PipelineDetailPage.layoutFlip.test.tsx` (real page + real `usePipelineDetailPage`, service layer mocked, `matchMedia` flipped after mount). Steps filter(4 rows saved) -> compute(4 saved) -> limit; edit 1 sets the filter to 240 (compute draft count 2, row "4 → 2"); edit 2 makes the compute expression invalid (step in error, last good count 2); then the viewport flips to phone.
RED on unfixed code (tracker per layout): `Expected: "4 → 2"  Received: "4"` — the fresh phone tracker reseeded the errored step from the saved walk.
GREEN after lifting the tracker and walker (`createDraftFrameMemory`, owned by `usePipelineDetailPage`, passed through `usePipelineDraftPresentation`).
The assertion is on the ROW COUNT of the errored step; the preview rows come from the same `GoodFrame` (`{count, rows}`) entry in the tracker, so they are the same last-good frame.

## Item 3 (D8) — closed dialogs do not re-render on a draft edit
Test: `ui/PipelineDetailPage.closedDialogs.test.tsx` (real `PipelineDetailPage` + real `usePipelineDetailPage`; `shared/ui/Modal` wrapped by a counting pass-through keyed by `ariaLabel`; edit a draft threshold; Modal render counts of "Share pipeline Revenue rollup", "Pipeline schedule" and "Add step" must not move).
RED on unfixed code: `Expected: 4  Received: 5` (first closed dialog re-rendered by the edit).
GREEN after `useLatestCallback` on the 4 function props (Share `onClose`, Schedule `onClose`, StepPalette `onSelect`/`onClose`) and `memo` on the three dialogs. `hooks/useLatestCallback.test.tsx` covers the hook.
MUTATION: removing `memo` from `PipelineScheduleDialog` makes the test fail again (`Expected: 4  Received: 5`); restored, passes.
Item 14: `PipelineScheduleDialog.rerender.test.tsx` now passes the literal `pipelineId="p-1"`.

## Item 11 (D9) — copy
- "from a deleted step": `state/laneLayout.test.ts` "names a step that no longer exists 'a deleted step'". RED with the fallback still "an unknown step": `Expected: "a deleted step"  Received: "an unknown step"`; GREEN after the change.
- Cascade dialog no longer renders `impact.hints`: `PipelineDetailPage.draftMode.test.tsx` "a save that would remove other things ..." now sends hints `["Removes 1 step(s).", "Removes 1 output(s)."]` and asserts no `(s)` text. RED against the unfixed `PipelineDraftDialogs.tsx` (1 failed, 24 passed); GREEN after.
- Padded empty state: CSS only (`.step-preview__body .ui-data-grid__empty` gets the note's inset); it cannot go red in jsdom, so it is checked in the visual pass (screenshots).
- Side effect of item 10: `PipelineDetailPage.spineEditing.test.tsx` "an edit followed by Remove ... Discard" used to rely on the restored step being auto-selected (the bug). It now selects the restored step explicitly.

## A (D10) — "updating" while settling
Tests (`ui/liveOutput/LiveOutputColumn.test.tsx`, "while a newer draft frame is settling"): (1) edit shows "updating" on the previous frame, then "live" with the new value; (2) an unrelated re-render (new page and presentation objects, a run-status change) never shows "updating"; (3) the burst start does not re-render `LiveOutputBody` (counting memo wrapper), only the newer frame does.
RED on unfixed code: test 1 `Unable to find a label ... "Output is updating"`; test 3 fails the same way (no "updating" at the burst start).
Test 2 cannot go red on unfixed code (nothing flips to "updating" there): it is a GUARD with a mutation proof — making `isSettling` return true whenever the `frames` objects differ (`fresh !== shown`) fails it (`1 failed, 15 passed`); restored, `16 passed`.
The existing test "does not re-render its view for an edit" was loosened to allow the one extra view render when the burst starts (design D10: at most one extra view render, body and chart skipped).

## B (D11) — coalesce cap
Test: `hooks/useIdleCoalesced.test.ts` "renders an intermediate value at the cap during a continuous burst, even if the browser never goes idle" (fake timers, `requestIdleCallback` stub that never fires, a change every 100 ms for 3 s; jest's modern fake timers fake `performance.now`, confirmed: the cap fires at 1500 ms).
RED on unfixed code: `Expected: > 0  Received: 0`. GREEN after the cap bypasses `whenIdle` and resets `pendingSince`.

## C (D12) — onToggle identity
Test: `ui/spine/PipelineSpineLayout.onToggle.test.tsx` (real page, `LiveOutputColumn` replaced by a prop-capturing stub; edit a draft; all captured `onToggle`s are one function). It is a GUARD (passes on main). Mutation: replacing `useCallback` with a plain arrow in `PipelineSpineLayout.tsx` fails it (`Expected: 1  Received: 5`); restored, passes.

## F (D13) — reference marks under noAnimation
Test: `features/panels/ui/ChartPanel.noAnimation.test.tsx` "also turns off the reference marks' own animation". RED on unfixed code (marks kept `animation: true`). GREEN with `withoutMarkAnimation` applied in `ChartPanel`'s `noAnimation` memo only. A second test asserts a normal chart's marks keep `animation: true`. `chartShapeSignature.ts` is untouched and the signature is taken from `builtOption`, before the post-processing, so a non-`noAnimation` chart's signature cannot change. Browser check under Full: see the visual pass below.

## G (D14) — polish
- Error shown once: `liveOutputSource` error/stale note is the constant "Showing the last good render."; `liveOutputSource.test.ts` and `LiveOutputColumn.test.tsx` updated (`queryByText("bad expression")` is absent in the Output view).
- One "stale" style: the column's `.live-output__marker--stale` warning-tone rule was removed, so it is the muted mono caption like `.step-preview__state`.

## I (D15) — token guards
`theme/motionTokenGuard.css.test.ts` and `theme/elevationTokenGuard.css.test.ts` no longer pin 151; they assert `> 100` files and that `liveOutput/LiveOutputColumn.css` is in the scanned set. Mutation: pointing the glob at an existing empty directory fails both (`7 failed, 3 passed`, both "walks every CSS file" tests among the failures); restored, 29 pass.

## Items 4, 5 and 7 — e2e (`e2e/hel1685-draft-polish.spec.ts`, dev project, under the e2e lock)
Seed: a static source, a filter -> sort -> compute pipeline, run once; Outputs per test as noted.

### Item 4 (D1) — notice band
Test "1280x800: a refused save's notice takes only its own height and the page does not scroll (item 4)": steps only (no Outputs, the shortest page), edit the filter, `draft/save` answered 500 so the "Couldn't save" notice shows, then `body.top - notice.bottom <= 16` and no document scroll, in dark and light.
RED against unfixed `PipelineSpineLayout.tsx/.css` (reverted for the run): `gap between the notice and the step body (dark)  Expected: <= 16  Received: 71`.
(With three Outputs the spine is taller than the viewport, the `1fr` row collapses to 0 and the band does not show: that run passed on unfixed code, which is why the test uses the short page.)
GREEN with the notice slot and the 4-row grid. Screenshots: `e2e-evidence/HEL-1685/notice-1280-{dark,light}.png`.

### Item 5 (D2) — phone overlap: REPRODUCED (cycle 2; the cycle-1 "not reproducible" record was wrong)
Root cause (evaluation-1.md): `.actions-menu` (shared `ActionsMenu.css`, z-index 4) and `.mobile-actions` (z-index 2) share the page's stacking context because `.mobile-body` creates none, so an Output card's kebab paints over and hit-tests above the floating bar (the draft-status pill and "Save & run"). The cycle-1 test only looked at scroll END against the pill's box, so it could not see it.
Fix: `isolation: isolate` on `.mobile-body` (`PipelineMobile.css`); the shared `ActionsMenu.css` is untouched. An open menu is not clipped: `ActionsMenu` renders its popover through `createPortal`, outside the list.
Test: "375px / 430px: an Output card's menu never takes a tap meant for the floating action bar (item 5)": a draft open (step sheet closed), nine Outputs, `.mobile-body` walked from top to end in 12 px steps; at every position, each Output menu button whose centre lies under the draft-status pill or a pill button must have `elementFromPoint` inside `.mobile-actions`; it also asserts at least one such position exists (not vacuous). Dark and light.
RED on unfixed CSS: `taps the Output menu took from the bar (dark)`, received `scrollTop 12: popover__trigger actions-menu__trigger`, ... (both widths).
GREEN with the isolation: all four specs pass (`4 passed (37.0s)`).

### Item 7 (D4) — deleted Output request: REPRODUCED, root cause differs from the design's guess
Test "1280x800: Save & run that removes an Output requests no preview of it (item 7)": delete the compute step (the metric Output's node), Save & run, confirm the cascade, wait 3 s; no request may name the removed Output.
RED on unfixed code: `Received: "POST /api/pipelines/<id>/preview?outputId=<removed id>"`.
Probe (temporary `console.trace` in `previewOutput`, removed): the call comes from `usePipelineRunStream`'s `onTerminal`, requesting ALL THREE Outputs including the removed one, and the fourth call (from `settleSaved`, correct list) follows it. So the terminal SSE event arrives BEFORE the Save & run response is processed (`setSseActive(true)` precedes the post, and a small run finishes first): `outputsReplaced` has not run yet, in the store or in the render ref. Taking the ids from the store (the design's D4 mechanism) would not help; the design's "window between `outputsReplaced` and the re-render" is not the window.
Fix: a ref shared between `usePipelineDraftSave` (it already had `savingRef`) and `usePipelineRunStream`; `onTerminal` still resets the run-scoped previews but requests no preview while a draft save is in flight, because `settleSaved` refreshes the previews from the saved definition's Outputs. Unit test `hooks/usePipelineRunStream.test.ts` (in flight: no preview, reset still dispatched; not in flight: every known Output refreshed; RED before the change by a compile error, the `draftSaveInFlightRef` argument did not exist). GREEN: e2e passes.

## Docs, nits and the DESIGN.md carve-out
- DESIGN.md §10 "Chart refresh morph": one added line, "Carve-out: live draft previews (§11) update in place with no morph at every motion level (`ChartPanel` `noAnimation`)." (owner answer `add-carveout`, `answer_source: human`, `.concertino/runs/HEL-1685/events.jsonl`).
- Archived `2026-10-19-draft-mode-live-preview-ui/design.md`: the Discard-fetch bullet now reads as resolved by `amend-ac-fetch-on-view` (`e2e/hel1631-draft-mode.spec.ts` has no `test.fixme`: `grep -n fixme` is empty); the `baseSignature` bullet states why Outputs are not part of it. Checked against `state/pipelineDraft.ts`: `baseSignature` covers steps only, `definitionMatchesBase` compares Outputs at save time, and "Add output" is disabled while a draft exists (`useSpineStepActions.tsx`, `blocked`), so the overlay holds nothing about Outputs.
- Item 14: literal `"p-1"` (see item 3 above).

## Deferrals (D17) — each from owner escalation HEL-1685-1792681541852-95d9a1 (`answer_source: human`), listed in `proposal.md` Non-goals
| Item | Decision | Reason |
| --- | --- | --- |
| 1, 2 (first-edit warm-up, broader memoisation) | declined, measurement recorded (`decline-record-measurement`) | prod build measures edit 1 = 32 ms and edits 2-10 <= 26 ms against the 100 / 50 ms budgets (re-measured below); the dev-build 50-60 ms is React's development runtime |
| 3 (closed-Modal render cost) | pipeline page only (`pipeline-page-only`); shipped here | no change to the shared `Modal`; the three always-mounted pipeline-page dialogs are fixed |
| 13 (two hooks over the soft size budget) | deferred, follow-up for the driver to file | a structural split of `usePipelineDetailPage` / its sibling is a refactor of its own; this change adds ~7 lines to the 507-line hook |
| D (non-focused server-resolved Output shows a stale frame) | deferred, follow-up | needs a transport change (request previews for non-focused Output nodes), not a polish fix |
| E (compare overlay, plain-chart tile) | deferred, follow-up | new features, not polish |
| H (server column order for the saved panel) | deferred, follow-up | a backend change; this ticket is frontend only |
| shared `Modal` change | out of scope | owner ruling `pipeline-page-only` |
| J (one-frame offset in the dev-build measurement) | no action | moot for the prod-build budget |
Also out of scope: HEL-1684, HEL-1696, HEL-1697, and the CI / e2e-harness files (HEL-1699). No follow-up tickets were filed by this run; the driver files them.

## 4.3 Local @prod-build latency (production build via `npm run e2e:prod-build`, DEV_PORT=7117, backend 10024)
First attempt on a free port (7118) failed at login: the lane's backend only allows CORS origin `http://localhost:7117` (`CORS_ALLOWED_ORIGINS` is set from DEV_PORT by `start-servers.sh`), so `Sign in` showed "CORS request rejected: invalid origin" and `page.waitForURL("/home")` timed out; not a product defect. Re-run on 7117 (dev server stopped with `stop-servers.sh`, the backend restarted with a private copy of the canonical script with the frontend start blanked, build served by `vite preview` through `e2e-prod-build.mjs`):
- `hel1631-draft-mode.spec.ts` burst @prod-build: per-edit latency ms 6.3, 2.3, 2.3, 1.6, 1.7, 1.9, 2.0, 1.6, 1.8, 1.4 (edit 1 < 100 ms, edits 2-10 < 50 ms): PASS.
- `hel1632-live-output.spec.ts` 10-edit burst with a chart Output on screen @prod-build: step-count latency ms 5.5, 2.5, 2.3, 2.0, 1.7, 1.9, 1.9, 1.8, 1.4, 1.9; input to live-output update ms 261.1, 256.4, 256.8, 256.2, 255.3, 255.9, 256.1, 255.7, 254.8, 260.5 (the 250 ms quiet window plus one idle tick): PASS.
- `prod-build.guard.ts`: PASS. `3 passed (11.3s)`.

## 4.4 Visual pass (running app, dev server, a temporary spec that is not committed)
Screenshots in `/home/matt/Development/helio/.concertino/scratch/HEL-1685/`: 1280x800 notice (`notice-1280-{dark,light}-{full,subtle,off}.png`), 1280 live column (`live-1280-*`), 900x800 and 900x700 with the Output disclosure open (`disclosure-900x{800,700}-*`), phones 375 and 430, Steps and Preview tabs (`phone-steps-*`, `phone-preview-*`); every combination of dark/light and Full/Subtle/Off (24 runs, all passed).
- Notice (item 4): the step body starts directly under the notice at 1280 in both themes and all three motion levels (compare `notice-1280-dark-full.png` with the 71 px band on the unfixed layout).
- Disclosure (G): CORRECTED in cycle 3, see "Cycle 3" below. The cycle-1 claim (280 px cap, heading visible) was wrong: `min(40vh, 280px)` was a no-op at 900x700 and the editor's first input row was still clipped.
- Reference marks (F): under Full, Subtle and Off, on a live draft redraw in the Output column, every `markLine.animation` read from the ECharts instance is `false` (`[visual] <motion> <theme> markLine.animation: [false]`).
- Live marker (A/G): "live" in the success tone; the error note is not repeated; the "stale" marker is the muted mono caption.
- Phones: the draft-status pill floats over the scrolling list by design (opaque pill); at the scroll end the last Output card clears it (item 5, see above). The padded "No rows to preview." empty state is CSS only: it shows after an error on a step whose draft frame is empty; checked by inspection of the rule, not by a screenshot of that rare state.

## Cycle 2 additions
- Item 7, ordering window: `onTerminal` now reads the Output ids from the store at terminal time (`selectOutputsForPipeline` through a thunk's `getState`) in addition to skipping while a draft save is in flight. `hooks/usePipelineRunStream.test.ts`: the store already lost the removed Output while the last render still listed it; only the kept Output is previewed. (`allOutputsRef` is no longer passed to the stream.)
- Item 8: `PipelineDetailPage.layoutFlip.test.tsx` also opens the errored step on the phone and asserts its preview shows the draft's last-good 2 rows (saved: 4). Mutating the frame memory to a fresh one per layout still fails the test at the count assertion (`Expected "4 → 2"  Received "4"`).

## Cycle 3 — addendum G disclosure (skeptic-final-1)
Measured on the unfixed CSS: at 900x800 and 900x700 the filter editor needs 267 px but `.spine-body__editor` was held to 45% of the column (`max-height: 45%`), so its first input row was clipped and scrolled inside itself.
Fix (`PipelineSpineLayout.css`, disclosure layout only): the open Output section is capped at `min(30vh, 200px)`; the editor no longer shrinks (`flex-shrink: 0`, `max-height: max(45%, 290px)`, so a taller aggregate or join editor still scrolls inside itself); the preview table, which scrolls, takes the squeeze (about 100 px at 900x700). The 1280 three-column layout is untouched (rules are scoped to `[data-live-layout="disclosure"]`) and the phone layout does not use this stylesheet's body grid.
Test: "900px wide: with the Output section open the step editor shows its first input row with no inner scroll (addendum G)": for 900x800 and 900x700, dark and light, the section open, `editor.scrollHeight <= editor.clientHeight + 1`, the first condition row's bottom inside the editor, no document scroll.
RED on the unfixed CSS (`da39f0f14` version restored for the run): `editor scrolls inside itself (900x800 dark)  Expected: <= 161  Received: 267`.
GREEN on the branch: passes. Screenshots `e2e-evidence/HEL-1685/disclosure-900x{800,700}-{dark,light}.png` (the editor shows the full first row, the preview table is short and scrolls).
Nits: the redundant `as RootState` cast removed from `usePipelineRunStream.ts`; archived HEL-1631 design.md D13 now says `clearAuth` clears kept drafts; the DESIGN.md §10 line is wrapped like its prose.
