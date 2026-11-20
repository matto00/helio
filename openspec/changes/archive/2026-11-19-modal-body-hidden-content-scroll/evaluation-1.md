## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c6bd8d5a8da9745dbfce7401e9362b0cf9865039` against live-resolved base `94a8ef292ba5475e3906c2aa5760110a9d23abe9`.

### Phase 1: Spec Review — FAIL

Verified:
- Commit order holds. `3129212f4` (red run) contains only the e2e spec, planning docs and `evidence/red-run.txt`.
  It has no CSS change. The fix (`Modal.css`, `Modal.css.test.ts`, the `OutputEditorSheet.css` comment) lands in
  `ebd862778`.
- C15 holds. In the committed red run the injected case (2x-clientHeight spacer, `.sr-only` span as the last child,
  body and dialog scrolled to the top) is red for every modal case at every viewport and theme. It fails 6 of 6 tests,
  with dialog scrollHeight 1830-3686 against a content bottom of 719-758. Every natural case is green and is labelled
  a GUARD in the spec header and in inventory.md.
- AC2 (the fix and its justification) holds. The shared `.ui-modal__body { position: relative }` rule is justified
  against every positioned body descendant in the probed modals. `abs-before-fix.txt` and `abs-after-fix.txt` are
  byte-identical; I re-ran `diff` and it is clean. The popover rects in `popover-rects.txt` are identical with and
  without the rule.
- AC3 (the guard) holds. The e2e spec covers 375x812, 390x844 and 1280x800 in light and dark, and the unit guard is
  in `Modal.css.test.ts`.
- `OutputEditorSheet.css` changes only the comment.
- No scope creep. No API or schema change.

Issues:
1. **AC1 is only partly met, and tasks 1.2 and 1.3 are ticked without matching the work.** AC1 asks for every modal
   or sheet whose scrolling body contains absolutely positioned hidden content, with scrollHeight measured against
   content height for each. The inventory live-probes 8 of the 30 `<Modal>`/`<BottomSheet>` consumers. It puts the
   other 22 in a single sentence with a shared reason: "Reachable only with external services, a specific state, or a
   non-default tab."
   - That reason is false for many of them. They need no external service, and existing e2e specs already open them
     with plain seeded data:
     - `CommandPalette`: Control+k, e.g. `e2e/hel1088-compact-counter-chrome.spec.ts:167`.
     - `OutputHistoryModal`: `e2e/hel1277-output-history-scrubber.spec.ts`.
     - `ShapePickerModal` and the draft dialogs: `e2e/hel1733-draft-outputs-shapes-drafts.spec.ts`.
     - `RunHistoryModal`: this spec's own `seed()` already runs the pipeline.
     - Also `StepPalette`, `AddRootModal`, `OutputPicker`, `PanelInspectView`, `PanelFullscreenOverlay`, and
       `MobileStepSheet` at phone widths.
   - Task 1.3 requires "the statically found absolute descendants" for each unprobed modal. inventory.md lists none
     per modal. It refers to "the CSS grep below", and no grep output appears in the file. Design Decision 1 promised
     a jsdom render that lists absolute descendants for unreachable modals. That was not done.
   - For those 22 modals the inventory therefore establishes neither which ones hold absolutely positioned hidden
     content nor their scrollHeight against content.
   - My own static pass suggests the shared rule is still safe. Every `position: absolute` rule I found that can render
     inside these modals (tap-target `::after` expanders, `.command-palette__search-icon`,
     `.proposal-review__preview-cell`, DataGrid handles, `.panel-detail-modal__upload-input`) has a positioned parent
     or is inside the already positioned `.panel-detail-modal__scroll-area`. That is evaluator inference, not the
     executor's evidence, so AC1 still stands unmet.
2. **The Resolution overstates the committed red run.** `design.md` (Resolution, "Red first") says the injected case
   "is red for all 8 live-probed modals" in committed `3129212f4`. That commit's spec has 7 cases. `panel-detail-edit`
   was added in `ebd862778` (`git diff 3129212f4 ebd862778 -- e2e/`), and `grep -c panel-detail evidence/red-run.txt`
   returns 0. Its "dialog 2359 vs 812 RED" row in inventory.md comes from mutation a, not from the committed red run.
   The behavior is real (I reproduced it under mutation a). Only the attribution is wrong.

### Phase 2: Code Review — PASS

Gates, run fresh in WORKTREE_PATH:
- `npm run lint`: exit 0, zero warnings.
- `npm run format:check`: all files pass.
- `npm test`: exit 0. Root 70 suites / 617 tests, frontend 873 suites / 10304 tests. Run with
  `HELIO_JEST_MAX_WORKERS=3` and `nice -n 19`.
- `npm --prefix frontend run build`: exit 0.

Review:
- The CSS change is one declaration with an accurate comment. `position: relative` creates no stacking context and is
  not a containing block for `position: fixed` elements, which is correct.
- The unit guard is honestly labelled static, not a discriminator.
- The e2e measurements come from element geometry, not hard-coded pixels. Failures are collected per modal so one red
  case does not hide the others.
- I found no CONTRIBUTING.md or DESIGN.md [mechanical] violations: no tokens or new UI, and no dead code. The
  `listPositioned` helper is used for the abs log.

### Phase 3: UI Review — PASS

- Servers were started with `start-servers.sh` on 7206/10113 against the lane DB `helio_hel1774`, with
  `ANTHROPIC_API_KEY` empty. `assert-phase.sh servers` passed. Servers were stopped with `stop-servers.sh` afterwards.
- `e2e/hel1774-modal-scroll-extent.spec.ts` on the fix: 8 of 8 pass (6 scroll-extent tests, 2 popover tests).
- My own mutation a removed `Modal.css:193` `position: relative;`. Result: 6 of 6 scroll-extent tests red, with the
  injected case red on all 7 modals at 375 light (for example output-editor 3622 vs 729.8, panel-detail-edit 2359
  vs 812). The 2 popover tests stayed green. I restored the file with `git checkout`, and `git status` is clean.
- Regression specs run in full: `hel1668-phone-sheet`, `hel1752-output-editor-footer-fit`,
  `hel1763-output-editor-preview-scroll`, `hel773-top-anchored-mobile-nav-sheet` and
  `hel909-output-picker-panel-sheet`. 37 of 37 pass.
- No visible positioned child moved in the probed modals (abs before and after are identical). The scope of that
  claim depends on Phase 1 issue 1.

### Overall: FAIL

### Change Requests

1. In `evidence/inventory.md`, replace the single "Not live-probed" sentence with one row per remaining consumer,
   from the 30-file grep.
   - **Reachable with seeded data:** add the modal as a case in `e2e/hel1774-modal-scroll-extent.spec.ts`, or at
     minimum probe it with the same `measure` and `listPositioned` helpers. Record natural body and dialog
     scrollHeight against content, plus its positioned body descendants with their containing blocks. This covers
     `CommandPalette`, `RunHistoryModal`, `OutputHistoryModal`, `StepPalette`, `ShapePickerModal`, `AddRootModal`,
     `OutputPicker`, `PanelInspectView`, `PanelFullscreenOverlay`, `MobileStepSheet` (phone),
     `PipelineDraftDialogs` and `BottomSheet`. Existing specs show how to open several of them.
   - **Genuinely unreachable** (connector modals, `MfaEnrollModal`, `AskDrawer`, `QuickLauncherOverlay`, the
     proposal and patch-set reviews): give the specific reason, and list that modal's statically found absolutely
     positioned descendants with their nearest positioned ancestor. This is what task 1.3 and Decision 1 require.
     Include the actual grep command and its output that the text currently refers to as "the CSS grep below".
   - If any newly probed modal has a visible absolute descendant whose containing block is currently the dialog,
     record its before and after rects, as Decision 2 requires.
2. Correct `design.md` Resolution ("Red first") and the inventory.md finding paragraph. The committed red run
   `3129212f4` covers 7 modals. `panel-detail-edit` was added in `ebd862778`, and its unfixed-CSS red comes from
   mutation a (`evidence/mutation-a-shared-rule-removed.txt`). Do the same for any case added under change
   request 1: state which run proved it red.
3. Re-tick tasks 1.2 and 1.3 only once inventory.md actually satisfies them.

### Non-blocking Suggestions

- Label the popover test in the spec as a GUARD. It is green both with and without the rule, so it is not a
  discriminator, and the comment only implies this.
- Task 4.4 claims a regression sweep but no transcript is in evidence/. Persisting one would make the claim
  checkable. I re-ran the five named specs: 37 of 37 pass.
