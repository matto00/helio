## Context

See proposal.md and ticket.md (owner triage); ground truth origin/main da39f0f14, premise evidence in
`.concertino/runs/HEL-1685/evidence/premise-validation.md`. FE/ = `frontend/src/features/pipelines`. Bug fixes (items
4–10) follow `.concertino/laws/systematic-debugging.md`: red test on main first, then the fix. Items 5 and 7 are not
runtime-confirmed: if either does not reproduce after a real attempt, record it in `evidence.md` and change no code.

## Goals / Non-Goals
**Goals:** close or decide every item kept in scope. Bugs 4–10 each get a test that fails first, and each is checked
on desktop and phone in light and dark. **Non-Goals:** everything the owner deferred (see proposal.md Non-goals). No
backend change: the "(s)" hint strings in `DraftSaveTransaction.scala` stay as they are. No change to the shared
`Modal`, and no CI or e2e-harness files (those belong to the HEL-1699 lane).

## Decisions
**D1 — Notice row (item 4).** `ui/spine/PipelineSpineLayout.css` declares 3 rows, but there are 4 children while a
`.draft-notice` shows, so the body falls into an implicit row. Fix: wrap `PipelineDraftNotices` in an always-mounted
`.spine-notice-slot`, the same pattern the strip slot uses, and set `grid-template-rows: auto auto auto minmax(0,1fr)`.
An empty slot collapses to zero height. Rejected: putting the notice inside the header, which changes the header's
narrow-width container rules. Test: an e2e at 1280×800 that forces a save-error notice and asserts `body.top -
notice.bottom <= 16px` and that the document does not scroll.

**D2 — Phone overlap (item 5).** Reproduce at 375 with a draft and an Output card, in light and dark. The suspect is
the floating `MobilePipelineActions` bar with `data-slot="draft-status"` sitting over the Output card's `ActionsMenu`,
because the `--pipeline-mobile-actions-h` clearance may not cover it. Fix the clearance, or the slot's own layout,
whichever the probe shows is the cause. Test: an e2e scrolled to the END of the Output list (the last card at scroll
end, where the bar's clearance must hold) that asserts the bounding boxes do not intersect and that the kebab can be
clicked (`elementFromPoint`). Check 430 as well.

**D3 — Session expiry (item 6).** Use the repo's existing pattern for clearing session state: a listener on
`clearAuth`, registered through `startAppListening` (as in `features/dashboards/tabs/warm/warmListeners.ts:204-211`,
which clears warm state for logout and the 401 path). The new listener calls `clearKeptDrafts()`. `clearAuth` is
dispatched by logout, by the 401 interceptor and by a failed `rehydrateAuth`. It therefore also covers expire → reload
→ rehydrate gets a 401 → `clearAuth`, before anyone signs in again. Reducers stay pure; the logout thunk's explicit
call stays as an idempotent first clear. **Stated cost:** `rehydrateAuth` catches every error, so a network failure at
page load also drops kept drafts. The app already treats that case as signed out and redirects to /login, so this is
consistent with the session having ended; it is listed in the PR body. Test: dispatch `clearAuth` through a real store
with `helio.pipelineDraft.p1` seeded and assert the key is gone (red on main). A second test drives the 401 interceptor
end to end.

**D4 — Deleted Output refresh (item 7).** `usePipelineRunStream` `onTerminal` reads `allOutputsRef.current`. First
probe whether a terminal event can arrive before the post-save `outputsReplaced` render. If it can, take the ids from
the store at terminal time (the same source `outputsReplaced` writes) rather than the render ref, mirroring the
`outputIds` that `usePipelineRunAndSaveActions` already passes. Test: a hook test that fires terminal after
`outputsReplaced` but before re-render, and asserts no `previewOutput` for the removed id.

**D5 — Frames across layouts (item 8).** The view tracker and the incremental walker are `useState` inside
`usePipelineDraftFrames`, which runs inside each layout, so the swap at 768px drops them. Lift both into
`usePipelineDetailPage` (it owns the draft overlay and survives the swap), and pass them down through
`usePipelineDraftPresentation`. Only one layout is mounted at a time. Lifting does not change the walker's reuse
contract. **Scope (spec narrowed):** this covers client-evaluated steps. `useDraftPreviewTransport` stays per-layout,
so a server-resolved step re-requests its preview once after a switch; that is the existing first-view behaviour, with
no new request pattern. Test, a real red, asserting the ERRORED step: edit 1 makes step 2's draft count (and its first
row) differ from its saved count and rows (e.g. a filter on step 2: saved 5 → draft 3); edit 2 makes step 2's config
invalid so that it is in error; flip the `matchMedia` mock to phone; assert step 2 shows the draft's last-good count 3
and that its preview rows are the draft's last-good rows. On main a fresh tracker reseeds step 2 from the saved walk
(`draftStepView.ts:174-178`) and shows 5 and the saved rows, so the test is red. The addition to the 507-line hook is
kept minimal: two `useState` initialisers, returned as one object. The owner deferred the split (item 13).

**D6 — saveError (item 9).** (A per-step seam already exists: `stepSaveErrors` in `useStepSaveSeam`, rendered through
`SpineStepRow.savedError`. What routing would need is draft-key to step mapping for steps created in the draft.) Choose
"remove the dead plumbing". `saveError` and `saveErrorIsValidation` in `hooks/useStepCardEditorState.ts` are never set,
but they are threaded through `StepOpEditor` into 6 configs. Remove them, the props and the `InlineError`s that render
them, and update `useStepCardState.characterization.test.ts`. The live path stays: a refused save shows a page notice
naming the step (`stepNamedBy` in `usePipelineDraftSave`). Test: a type-level and grep check that no `saveError` prop
remains, plus a test showing a 400 `Step '<id>': …` names that step in the notice. That test fails first only if it is
absent on main; otherwise it is labelled a guard, not a red.

**D7 — Restored step (item 10).** `useAddedStepId` treats as added any id missing from the *previous* list. Keep a
cumulative set of every id seen since load, so an id is "added" only the first time it ever appears. First verify which
list feeds it (saved vs draft steps). Test: a hook test where the list is base → base minus s2 → base, asserting
`addedStepId` stays null; it fails on main.

**D8 — Closed dialogs (item 3, owner: pipeline-page-only).** They cannot be mounted conditionally: Modal's focus
restore needs the true→false transition (HEL-1136 CR1, `ui/spine/useSpineStepActions.tsx:201`). None of the three calls
`useAppSelector`, so `React.memo` works once the props are stable. Every function prop of the three dialogs goes
through `useLatestCallback`. Today's unstable ones are four: the inline `onClose` arrows of Share and Schedule
(`PipelineDetailDialogs.tsx:62,72`), `StepPalette`'s `onClose` (`useSpineStepActions.tsx:207`), and its `onSelect`
(`handlePaletteSelect`). That closes over `onInsertStep`/`onAddLaneStep`, which both layouts pass as new inline arrows
(`PipelineSpineLayout.tsx:69-70`, `PipelineMobileLayout.tsx:61-62`). Fix: a small `useLatestCallback` hook
(`FE/hooks/useLatestCallback.ts`). It returns an identity-stable function that calls the latest closure, assigned in
`useLayoutEffect`, and must never be called during render. Use it for all four at the dialog call sites, and wrap the
three dialogs in `memo`. Upstream layout callbacks are not touched. Test (real red): render the real page tree
(`PipelineDetailPage` through the real `usePipelineDetailPage`, with a mocked service layer), not a hand-built `page`
prop. Mock `shared/ui/Modal` with a counting pass-through keyed by the dialog's title, make a draft edit, and assert
the closed dialogs' Modal render count does not increase. On main it increases, so the test is red. Mutation: drop
`memo` from one dialog → the test fails.

**D9 — Copy (item 11).** An Output whose `nodeStepId` has no step reads "from a deleted step" (the `laneLayout.ts`
fallback, scoped to the Output subtitle). After an error, "No rows to preview." gets the table's standard empty-state
padding. `PipelineDraftDialogs` stops rendering `impact.hints` at all. The backend can only produce four hints
(`DraftSaveTransaction.scala:107-110`): steps, Outputs, panels and alert rules. The dialog already lists all four,   so
every hint repeats the list. The backend strings and the field are unchanged.

**D10 — Live marker (A).** "Settling" is computed in the OUTER `LiveOutputColumn` (`ui/liveOutput/
LiveOutputColumn.tsx:54`), which already holds both the fresh bundle and `coalesced = useIdleCoalesced(fresh)`. It is
passed to the memoised `LiveOutputColumnView` as one boolean `settling` prop; the fresh presentation is never passed
in, so the view still renders only on coalesced changes plus the settling flips. To know the displayed node, lift
`pick` state (`:95`) into the outer component (its setter is stable) and extract the Output resolution (`picked ??
selected-step Output ?? outputs[0]`) into a pure `resolveDisplayedOutput(outputs, pick, selectedStepId)` used by both.
settling = the resolved Output's node view in the fresh presentation differs from the one the view currently SHOWS (the shown bundle, which already
follows a step selection immediately per `LiveOutputColumn.tsx:64`, not the raw `coalesced` value), compared
by `view.rows` reference and `view.status`. Both come from memoised walks, so they are stable across unrelated renders
(round 2 verified this). While settling, a "live" marker reads "updating". Cost: at most one extra view render when a
burst starts, with `LiveOutputBody` and the chart skipped (memo, unchanged props). Tests: (1) an edit shows "updating",
then "live" after the coalesce; (2) an unrelated re-render (a dialog toggle, a run-status change) never shows
"updating"; (3) the burst start does not re-render `LiveOutputBody` (render-count).

**D11 — Coalesce cap (B).** Once `pendingSince + MAX_WAIT_MS` has passed, the timer callback calls `setShown` directly
instead of going through `whenIdle`. That way a newer value's cleanup cannot cancel a pending idle callback forever.
Test: fake timers plus a stubbed `requestIdleCallback` that never fires, with changes every 100 ms for 3 s, asserting
an intermediate shown value. It fails on main. The test asserts that the pending timestamp really advances under jest's
modern fake timers (they fake `performance.now`).

**D12 — onToggle guard (C).** A test that renders `PipelineSpineLayout` and re-renders it with an edited draft, and
asserts the `onToggle` passed to `LiveOutputColumn` keeps its identity. Mutation proof: removing `useCallback` fails
the test.

**D13 — Reference marks (F) and the §10 carve-out.** `referenceMarksOption.ts` sets `animation` per mark from
`!prefersReducedMotion()`. Apply it in `ChartPanel`'s existing `noAnimation` option memo by post-processing every
series' `markLine`/`markArea` to `animation:false`. The HEL-1584 shape signature (`chartShapeSignature`) must be
unchanged for non-`noAnimation` charts; a unit test asserts that. Verify in a browser that the marks don't animate on a
live redraw under Full motion. DESIGN.md §10 gains one line, in the "Chart refresh morph" bullet or as a table note:
live draft previews (§11) update in place without the morph at every motion level. Owner answer: `add-carveout`.

**D14 — Polish (G).** Disclosure (below 960, not 900): cap the open section at `min(40vh, 280px)`. At 900×800 and
900×700 the step   editor's heading must stay visible. One "stale" style: the live column marker uses the preview
table's muted mono caption, with no warning tone. "stale"   there is a status, not a warning. Error once: in the error
state, the live column note reads "Showing the last good render." without the message.

**D15 — Token guards (I).** In `theme/elevationTokenGuard.css.test.ts` and `theme/motionTokenGuard.css.test.ts`,
replace `toBe(151)` with a guard that cannot pass vacuously, e.g. `toBeGreaterThan(100)`, plus a check that a known
file (`LiveOutputColumn.css`) is in the scanned set. Mutation proof: point the glob at an empty directory and the test
fails.

**D16 — Docs and nits (12, 14, J).** Archived `2026-10-19-draft-mode-live-preview-ui/design.md`: at :174 mark the
question resolved by `amend-ac-fetch-on-view` and drop the stale `test.fixme`; at :176 state why Outputs are not in
`baseSignature` (Outputs cannot be edited during a draft, D2; `definitionMatchesBase` checks them at save; verify this
against `state/pipelineDraft.ts` first). Item 14: `"p-1"`. J: no action. Perf 1–2: prod-build numbers in evidence.md.

**D17 — Deferrals.** `evidence.md` and the PR body list each owner-deferred item (perf 1–2, 13, D, E, H, shared
Modal; J no-action) with its owner answer and reason. Follow-ups go to the driver, who files them; this run files none.

## Risks / Trade-offs
- [D5/D8/D10 touch the edit hot path] → local `@prod-build` latency e2e before Delivery (100 / 50 ms budgets).
- [D1/D2/D14 visual changes] → running-app pass at 1280, 900, 375 and 430, light and dark, Full, Subtle and Off.
- [New e2e spec vs shard weights] → run every frontend CI `check:*` script; never edit harness files (HEL-1699).

## Planner Notes
Self-approved small UI calls (PR body): D9 "from a deleted step"; D14 280px cap, muted "stale", note wording; D6
removal over routing; D3 rehydrate network failure drops kept drafts; D5 server-resolved steps re-request.
