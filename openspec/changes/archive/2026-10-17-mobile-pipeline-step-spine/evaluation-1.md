## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `8d1d12f33a4fdde6e9989a5ba7e1935af553c120` against live-resolved base `29cb0a60f41e72b0a6b26c15a28360c504fffdb8`
(origin/main, which already contains HEL-1583). The working tree was clean. My measurements are in
`/home/matt/Development/helio/.concertino/runs/HEL-1582/evidence/.concertino/scratch/HEL-1582/eval1/evaluator-measurements.json`
(persisted). Screenshots are in `.concertino/scratch/HEL-1582/eval1/`.

### Gates (my own fresh runs, not the executor's)

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (jest, 2 workers) | exit 0: root 61 suites / 524 tests; frontend 704 suites / 8861 tests |
| `check:tokens`, `check:openspec`, `check:spec-structure`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`, `check:e2e-types`, `check:repo-integrity` | all exit 0 |
| `openspec validate mobile-pipeline-step-spine --strict` | valid |
| Playwright, under the lock with 2 workers: `hel1582-mobile-pipeline`, `hel1628-source-sample-label`, `state-surface-contrast-guard` | 34 passed (3.1 min); teardown deleted 34 throwaway users |

The reused dev servers were checked before trusting them (MISTAKES.md, CON-155). The cwd of `:7014` and `:9921` is this
worktree's `frontend/` and `backend/`. No backend file changed between the branch's original base and 29cb0a60f.

### Phase 1: Spec Review — FAIL

- AC1 (fit at 375×812): PASS, measured myself. Source card is at 223.8–314.8, rows at 350.8 / 414.8 / 478.8 (each 60px),
  the Output card at 602.8–684.8, and the bar top at 696. All of it sits inside the scroller (211.8–744) at scrollTop 0.
- AC2 (every kind editable, swipe + visible close): PASS on function. Jest renders every `OP_TYPES` editor in the sheet.
  The e2e CDP touch drag passed in my run. Close and Escape both work, and Escape on an open Select closes only the
  listbox. The exit has a defect, see CR1.
- AC3 (clearance): PASS. Scrolled to the end, the last item's bottom is 679.8, at or below the bar top minus 8
  (696 − 8 = 688). The bar bottom (736) is at or above the nav top (744). At 390×844: 711.8 / 728 / 768 / 776. At 768×1024:
  bar 908–948, nav 956. `--pipeline-mobile-actions-h` resolves to 40px.
- AC4 (44px floor): PASS. My own `elementFromPoint` bisection at 375, 390 and 768 measured 18 controls each and found
  0 under 43.75px. The repo's `bisectHitExtent` sweep in the e2e also passed.
- No new request on page load: PASS. Load issues auth/me ×2, pipeline, steps, analyze, schedule (404, pre-existing),
  outputs, data-sources, dashboards and the source sample. There is no preview or run-history request. Runs adds exactly
  one `run-history` request and Preview adds exactly one `steps/:last/preview` request, both on activation.
- C4 (no edit to BottomNav, the phone shell or `Modal.*`): honoured. C6: see Phase 2. C7: honoured at rest. The
  computed transform is `none` and the Select listbox anchors 4px under its trigger (191–235, then 239).
- **Spec divergence:** the `pipeline-detail-mobile-layout` requirement "Phone touch floor and state contrast" says
  phone hover states of the new controls SHALL clear 4.5:1 for text. The Run pipeline pill's hover text is **3.95:1** in
  light (I measured it: ink #181511 on hover fill rgb(189,87,17)). The spec states no exception, but the e2e silently
  exempts the pill. See CR3.

### Phase 2: Code Review — FAIL

The structure is sound. The `useSpineStepActions` extraction preserves desktop behaviour, `RunHistoryList` and
`useAddedStepId` are clean extractions, and the river deletion is complete (`tsc` and the build pass). The sheet composes
Modal without editing it and has no literal timings, and the motion-literal guard covers the new files.

C6 spot-check: per-file `expect(` counts held or grew in all 9 retargeted files, and `it` counts are unchanged:
PipelineDetailPage.test 310→323, createPlacement 41→46, switch 70→73, draftCreate 41→52, creatingStep 15→26,
stepsError 27→27, shapeReparent 14→15, reorderGuard 7→7, spine 118→125.

The four §C judgement calls are acceptable:
- (1) Flush on pipeline switch matches the desktop. `StepCardFocused` sets `flushOnUnmount: true`, and the test still
  pins that nothing is sent against B.
- (2) to (4) follow from one modal sheet.

Issues:
- The sheet's exit paints the dialog at rest for one frame (CR1).
- Focus is lost after Move up/down from inside the sheet (CR2).
- The Run pill contrast exclusion is a weakened assertion (CR3).
- The shared `ActionsMenu` dialog-portal change has no guard (CR4).
- A DESIGN.md §3 [mechanical] violation on the back link (CR5).

### Phase 3: UI Review — FAIL

I verified on the running app at 375×812 (dark and light), 390×844 and 768×1024:
- No horizontal overflow, and gutters are 12/12.
- Hover state surface against the backdrop: dark 1.133–1.234, light 1.119–1.150. All are at least 1.10.
- Text on hover: dark 7.8–17.7. Light: 14.2–17.8 on every neutral control, and **3.95 on the Run pill**.
- Light focus rings: 3.19–3.48 against the backdrop.
- No console errors from the change. The only error is the pre-existing 404 on `GET /pipelines/:id/schedule` for a
  pipeline with no schedule, the same as on desktop.

Functional defects found live are CR1 and CR2.

### Overall: FAIL

### Change Requests

1. **Sheet exit paints the closed sheet back at rest for a frame** (`frontend/src/shared/motion/BottomSheet.tsx:57-60`).
   `finish` calls `clearSheetMotion(element)` and only then `closed()`. React commits `open=false` in a later task, so
   one frame is painted with the dialog still `open` and no transform: the full-height sheet flashes back on screen.

   A rAF log of a Close-button exit at Full motion (280ms move token):
   - frames 63808–64067: `open`, inline `translateY(796px)`, computed transform sliding 0 → 795.8
   - **64084: `open`, inline `""`, computed `none`** (the sheet is painted fully on screen)
   - 64101: closed

   The Subtle path has the same cause: `clearSheetMotion` removes `data-sheet-exiting`, so opacity returns to 1 before
   the close. The swipe-dismiss path shares `exit`.

   Fix: keep the exit transform/opacity until the dialog has actually closed. For example, call `closed()` first and
   clear the motion traces when `open` turns false (a layout effect in `BottomSheet`) or on the next open. Then the
   no-transform-at-rest contract still holds for every open sheet.

   Update `BottomSheet.test.tsx:176` ("holds the dialog open through its exit slide…"). It currently asserts the
   transform is `""` at the moment `onClosed` fires, which pins the defect. Instead, assert the transform/opacity stays
   while `open` is still true and is gone once `open` is false. Add a jsdom or e2e check that no committed state has
   `open` with no exit transform after the exit begins.

2. **Keyboard focus is dropped to `<body>` after Move up/down in the sheet.** At 375, I focused "Step actions for Sort
   rows", pressed Enter, moved to "Move step down…" and pressed Enter. The step moved and the sheet stayed open, but
   `document.activeElement` was `BODY`.

   Cause: `ActionsMenu.handleItemClick` (`frontend/src/shared/chrome/ActionsMenu.tsx:80-83`) does not restore focus. The
   only follow-up is `useSpineStepActions`' focus-after-move effect (`useSpineStepActions.tsx:88-96`, set at :119/:128),
   which targets the row button behind the modal. That button is inert, so `.focus()` silently fails. The retired river
   kept focus on its Move controls (the deleted `useLaneReorder` pending-focus), so this is an a11y regression on the
   phone surface.

   Fix: when the move comes from the sheet, return focus inside the sheet, for example to the sheet's "Step actions"
   trigger, without changing the desktop's focus-the-moved-row behaviour. Add a jest test in
   `PipelineMobileLayout.test.tsx` that activates Move down from the sheet's menu and asserts focus is inside the sheet
   dialog.

3. **The Run-pill contrast exemption is broader than the defect and its comment is false**
   (`e2e/hel1582-mobile-pipeline.spec.ts:827`, `:836-840`).
   - `r.control !== "Run pipeline pill"` exempts every Run-pill text ratio (both themes, rest/hover/focus) from 4.5.
   - The follow-up `expect(primary.length).toBeGreaterThan(0)` asserts nothing about the ratio.
   - The comment says "measured, not exempt", but the pill is exempt.

   The substance is legitimate. It is the shared `--app-accent-ink` on `--app-accent-strong` hover pair, identical on
   `.spine-header__btn--primary:hover` (`PipelineSpineHeader.css:241`) and `.ui-modal-btn--primary:hover`
   (`Modal.css:209`). Fixing it on the phone pill alone would fork the primary recipe. The assertion still has to be
   honest. Required changes:
   - (a) Narrow the exemption to exactly `theme === "light" && state === "hover" && control === "Run pipeline pill"`, and
     pin that one pair with a floor (for example `>= 3.9`) so a further drop still fails.
   - (b) Keep 4.5 for the pill's other states and themes. I measured dark hover at 8.03 and light rest at 6.49.
   - (c) Correct the comment.
   - (d) Name the exception in the spec requirement "Phone touch floor and state contrast"
     (`specs/pipeline-detail-mobile-layout/spec.md`) as a known product-wide token-pair defect with a follow-up (for
     the driver to file), so the SHALL and the code agree.

4. **The shared `ActionsMenu` change is unguarded** (`frontend/src/shared/chrome/ActionsMenu.tsx:69` and `:155`, portal
   target `closest("dialog[open]")`). Reverting it to `document.body` would fail nothing:
   - jsdom does not model the top layer.
   - No e2e opens the in-sheet Step actions menu. `grep "Step actions" e2e/hel1582-mobile-pipeline.spec.ts` returns
     0 hits.

   Add a test in `ActionsMenu.test.tsx` that a menu opened from a trigger inside an open `<dialog>` renders its
   `role="menu"` panel as a descendant of that dialog, and as a child of `document.body` otherwise. The CR2 e2e or jest
   test can also exercise it live.

5. **DESIGN.md §3 [mechanical] tap-target rule (compact icon-only chrome takes a `::after` expander; "No other control
   heights"):** `.mobile-header__back` is an inflated 44×44 painted box (`PipelineMobile.css:34-35`,
   `width: 44px; height: 44px`). Size it with a control token (`--control-sm` or `--control-md`) and give it the
   expander from the same file's touch block (lines ~981-1005: `position: relative` plus a 44×44 `::after`). Keep the
   chevron at the gutter. Re-run the touch sweep.

### Non-blocking Suggestions

- **Dry run hover in light (for the skeptic):** the hover fill moves only **1.025:1** from the pill's own rest fill,
  (253,252,250) to (255,255,255). It still clears the repo's 1.10 metric against the backdrop (1.119), so this is not a
  gate failure, but the hover is close to invisible. Dark is 1.133.
- **`PipelineMobile.css` is 501 lines and uses section dividers.** CONTRIBUTING says files over ~400 lines need a split
  proposal, and dividers are for files of roughly 1000+ lines. Consider splitting the sheet and the touch-floor blocks,
  or propose the split in the PR.
- **`MobilePreviewTab.tsx`:** the `lucide-react` import sits after the local imports, and
  `entries.find(...)!` uses a non-null assertion. Use a narrowed fallback instead.
- **`e2e/hel1582-mobile-pipeline.spec.ts` "every step kind" seed:** it logs and skips a rejected kind and only requires
  10 or more rows. Assert that every seeded kind was created, or record the covered kinds in evidence, so a silently
  dropped kind is visible.
- **AC2 e2e:** the variable `reorderRequests` collects a config PATCH. Rename it.
- **`recordCreateError` also changes the desktop focused editor:** a failed immediate create now shows inline there too.
  The change is reasonable but sits outside tasks.md and is tested only on the phone. Mention it in the PR, or add a
  desktop assertion.
