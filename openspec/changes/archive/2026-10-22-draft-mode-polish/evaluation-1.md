## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `7eddb2b36e06f08cf161fae7124a0b217ad93ab6` against the live review base `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9` (resolve-review-base.sh, origin/main).

### Phase 1: Spec Review — FAIL

Issues:
- **Item 5 (phone overlap) is recorded as "NOT REPRODUCED, no code change", but it reproduces.** At 375x812 (dark), with a 4-step pipeline and two Outputs, the first Output card's kebab paints OVER the floating action bar. Two cases:
  - At scroll top, with a draft open, the kebab sits on the right end of "Save & run". `elementFromPoint` at the kebab's centre (336, 716) returns `popover__trigger actions-menu__trigger`, so a tap there opens the Output menu instead of saving.
  - With `.mobile-body` scrolled 40 px, the kebab sits on the "Draft · unsaved changes" pill, which is the ticket's literal symptom. The same hit test returns the kebab, not the slot.

  Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1685/evidence/.concertino/scratch/HEL-1685/eval-phone-375-dark-kebab-over-draft-status.png` and `.../eval-phone-375-dark-draft.png`.

  Root cause (computed-style walk in the running app):
  - `shared/chrome/ActionsMenu.css:11` gives `.actions-menu` `z-index: 4`.
  - `features/pipelines/ui/mobile/PipelineMobile.css:402` gives `.mobile-actions` `z-index: 2`.
  - Both resolve in the same stacking context (`.app-body`, z=1), because `.mobile-body` (`PipelineMobile.css:254`, `position: relative`, no z-index) creates no stacking context of its own.

  evidence.md says "a card passes beneath the opaque floating pill by design". That holds for the card body, not for its menu button. The e2e guard only checks scroll END and only against the draft-status pill's box, so it cannot see this. The AC needs bugs 4–10 fixed or explicitly decided on a correct basis. This one is decided on a wrong premise.
- All other ticket items are addressed or deferred with the owner answers recorded (escalation `HEL-1685-1792681541852-95d9a1`, answer_source human, events.jsonl line 9).
- No AC silently reinterpreted apart from item 5 above. Item 7's mechanism differs from design D4. That is disclosed in evidence.md and backed by a probe and an e2e red, so it is acceptable.
- Tasks are all marked done. Task 1.2 says "or record not-reproducible". That record is wrong (see above).
- Scope: no CI, `.github/actions/e2e-setup`, playwright config, global setup or shard-weight files are in the diff. No backend or schema changes.
- DESIGN.md §10 carve-out: one line (`DESIGN.md:1350`). It is backed by `escalation.answered` `answer: add-carveout`, `answer_source: human`, `escalation_id HEL-1685-1792681019556-b440ce` in `/home/matt/Development/helio/.concertino/runs/HEL-1685/events.jsonl` (line 2). PASS.
- files-modified.md: all 66 non-change-dir paths in `git diff --name-only da39f0f14...HEAD` are listed explicitly, with no globs and no extras. The only unlisted paths are this change dir's own artifacts (`openspec/changes/draft-mode-polish/**`), which `squash-branch.sh` allowlists by construction. PASS.
- Standing constraint C1 (fails-first reds), spot-checked by reverting the fix source in a throwaway detached worktree at HEAD (removed afterwards):
  - Item 6: `store.ts` reverted gives `2 failed, 2 total` (both received the stored JSON). Real red.
  - Item 8: the frame-lift files reverted give `Expected "4 → 2", Received "4"`. Real red.
  - Item 3: the dialogs and call sites reverted give `Expected 4, Received 5`. Mutation (StepPalette `memo` only dropped) gives the same failure. Real red.
  - B: `useIdleCoalesced.ts` reverted gives `Expected > 0, Received 0` (1 failed, 4 passed). Real red.
  - Item 10: `useStepSelection.ts` reverted gives `Expected "b", Received "c"`. Real red.
  - Item 7 unit test: its red is only a compile error (the argument did not exist). The behavioural red is the e2e, as stated in evidence.md. Acceptable.

### Phase 2: Code Review — PASS

Gates, run fresh in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0.
- `npm --prefix frontend run typecheck`: exit 0.
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test`: root 61 suites / 524 tests passed; frontend 762 suites / 9369 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `check:openspec`, `check:spec-structure`, `check:e2e-evidence-paths`, `check:e2e-user-cleanup`, `check:e2e-types`, `check:tokens`, `check:e2e-prod-build-projects`, `check:no-credential-leak`, `check:eslint-ts-rules`, `check:repo-integrity`, `check:test-temp-dir-hygiene`: all exit 0.
- New e2e `e2e/hel1685-draft-polish.spec.ts` (dev project, under e2e.lock, against this lane's servers): 4 passed. The throwaway users were deleted by the harness.

Code observations:
- `useLatestCallback` assigns in a layout effect and is only used for event handlers, never during render. Correct.
- `memo` on Share, Schedule and StepPalette, with stable props, is verified by the real-page test.
- `withoutMarkAnimation` is applied only in the `noAnimation` branch, after the shape signature is taken. The test covers both branches.
- The `settling` / `resolveDisplayedOutput` split is pure and small. I verified it live: on a second edit the marker read "updating" for about 300 ms, then "live" with the new count (8 to 5). On the first edit from saved, the marker went from none to live with no "updating", which is consistent with D10's "live only" rule.
- The token guards now use a floor plus a known file. That is not vacuous.
- Item 9: no `saveError`/`saveErrorIsValidation` remains in `features/pipelines`.
- No dead code, untyped escape hatches beyond test mocks, or TODOs introduced.
- **Item 7 hole analysis (requested):**
  - The `draftSaveInFlightRef` skip is safe for a run started elsewhere. The SSE subscription is only active while this page has started a run (`sseActive` starts false, `usePipelineEditorState.ts:72`). Run now / Dry run refresh previews themselves after `unwrap()` (`usePipelineRunAndSaveActions.ts:69-70, 82-83`). A terminal swallowed during a save in flight is therefore always covered, either by the Run now handler or by `settleSaved`'s `refreshVisibleOutputPreviews(..., saved outputs)`.
  - Residual gap 1 (narrow, non-blocking): the server commits and runs, but the HTTP response is lost (network error after commit). The catch path neither adopts the definition nor refreshes previews, and the terminal refresh was skipped. Previews stay pre-run until reload. The page is already inconsistent in that case (the definition is not adopted, and an error notice is shown), so this is a minor degradation, not a regression in a working path.
  - Residual gap 2 (narrow, non-blocking): the flag clears in `finally` right after `settleSaved` dispatches `outputsReplaced`. `allOutputsRef` only updates in `usePipelineOutputSheets`' layout effect after the next commit. A terminal arriving in that microtask window would still read the pre-save list: the original D4 window. The probe showed the terminal arrives before the response, so this is unlikely. Reading the ids from the store at terminal time (D4's mechanism) in addition to the flag would close it.
- Prod-build latency run hygiene:
  - Nothing from it was committed (no `scripts/` paths in the diff), and the worktree's canonical `scripts/concertino/*` are unmodified (mtimes from the render).
  - The private copy lives at `.../scratchpad/cscripts/` in the session scratchpad, outside the repo, and is now byte-identical to the canonical `start-servers.sh`. It is a harmless leftover.
  - No listener was left on 7117/10024/4173 before I started servers.

### Phase 3: UI Review — FAIL

- Happy path: a draft edit gives a live column with "updating" then "live", and step counts update. Palette select via `useLatestCallback` inserts and selects the new step. Schedule dialog: Escape closes it and focus returns to "Add schedule".
- Console: only the expected 401 on `/api/auth/me` before login and the pre-existing 404 on `/schedule` (no schedule). No new errors.
- Item 4 (notice band): the e2e passes at 1280 in dark and light.
- **375 phone: the item 5 defect reproduces (see Phase 1).** The Output card kebab overlaps and intercepts both the draft-status pill and the "Save & run" button.
- 1280, 375 and dark were checked live. The executor's 24-run screenshot set covers 900/430/light/motion levels. I did not re-shoot every combination, because the FAIL is already established.
- Throwaway data (source `2dcc63da-4dcd-4fdf-a38c-cd1fdfa1c727`, pipeline `05962ac6-583d-4835-9890-6174fa8f4815`, outputs `e79ef959-eceb-4c86-ab46-e6557dddeec1` and `475e20b1-d8c3-4b0e-90d1-fa53830f3c4f`) was deleted by exact id. Servers were stopped with `stop-servers.sh`.

### Overall: FAIL

### Change Requests
1. **Fix item 5.**
   - Make the phone list's contents stack below the floating action bar. The minimal, local fix is `isolation: isolate` on `.mobile-body` (`frontend/src/features/pipelines/ui/mobile/PipelineMobile.css:254`). That gives the scrolling list its own stacking context, so `.actions-menu`'s `z-index: 4` (`shared/chrome/ActionsMenu.css:11`) can no longer escape above `.mobile-actions` (`z-index: 2`, `PipelineMobile.css:402`).
   - An alternative is to give `.mobile-actions` a z-index above 4. Do not edit the shared `ActionsMenu.css`, which the owner kept out of scope as a shared component.
   - Verify the stacking-context fix does not clip open ActionsMenu popovers inside the list (they should portal or stay inside the scroller).
   - Then update evidence.md: item 5 reproduced, with root cause, red and green.
2. **Make the item 5 e2e a real red, not a scroll-end-only guard.**
   - In `e2e/hel1685-draft-polish.spec.ts`, with a draft open at 375 and 430, scroll `.mobile-body` so that an Output kebab's centre lies inside the draft-status slot's box, and also inside the "Save & run" button's box.
   - Assert that `document.elementFromPoint` at that point is inside the bar (`slot.contains(hit)` / the button), not the kebab.
   - At scroll top with two Outputs (the first card's kebab under "Save & run"), this fails on current HEAD. Record the red in evidence.md per C1.

### Non-blocking Suggestions
- Item 7: additionally read the Output ids from the store at terminal time (`selectOutputsForPipeline` via `getState`), so a terminal arriving between `finally` and the post-save commit cannot request a removed Output. Optionally, refresh previews in `post`'s catch when `posted` was true, for the lost-response case.
- Item 8 test: design D5 asked to assert the errored step's preview ROWS as well as its count. The test asserts only the count (`PipelineDetailPage.layoutFlip.test.tsx:185`). Add a row assertion on the phone preview, since it is cheap.
- The `cscripts/` copy in the session scratchpad can be deleted.
