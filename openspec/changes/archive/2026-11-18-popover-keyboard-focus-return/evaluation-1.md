## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 478e5a24cb83f26412cf7a2b22dd6efdbabb29a6 against live base 9054da2a66ffb76619400817afbb7cdce4c8a1c2 (resolve-review-base.sh). Evaluator scratch: /home/matt/Development/helio/.concertino/scratch/HEL-1759/eval/.

### Phase 1: Spec Review — FAIL
- AC1 (red-first, keyboard-only, real-browser e2e): met. The executor's transcripts show the desktop cases red on unmodified source for the right reasons. The failed-save case got `BODY` where `BUTTON` was expected; the Shift+Tab cases got the trigger "inactive" (red-run.txt / red-run2.txt). The phone actions-menu case is red in red-run3-phone.txt and green in green-run-microtask.txt. Unit mutations M1-M6 each turn one test red (mutations.txt). I did not re-run the red side myself. I re-ran the green side (below) and checked the behaviour by hand on the running app.
- AC2 (HEL-1756 throwaway emails are plain): no edit. The executor's d4-emails.txt shows all 22 labels match PLAIN_EMAIL_LOCAL. The spec builds its labels with `replaceAll(" ", "-")`.
- Spec deltas (portal-popover-hook, popover-viewport-fit) match the code.
- No scope creep. The only out-of-hook change is the `tabIndex={-1}` on the editor scrim, which design D1 asks for.
- CONSTRAINTS C1-C16: the diff honours them. C16: files-modified.md carries the exact usePortalPopover.ts diff, and it matches `git diff`.
- **Issue: task 5.4 is ticked `[x]` in tasks.md, but the executor's own report says it was NOT done**, and there are no screenshots under the lane scratch dir. A completed task with no evidence behind it is a planning-artifact accuracy defect, and the artifact gets archived as is. I have now done the comparison myself (see Phase 3). The tick must point at that real evidence or be redone.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (transcripts in eval/):
- `npm run lint`: EXIT 0 (lint.txt)
- `npm run format:check`: EXIT 0 (format.txt)
- `npm run typecheck`: EXIT 0 (typecheck.txt)
- `npm test` (HELIO_JEST_MAX_WORKERS=3): root 66 suites / 579 tests and frontend 801 suites / 9756 tests all passed, EXIT 0 (jest.txt)
- `npm --prefix frontend run build`: EXIT 0 (build.txt)
- Every e2e spec that touches a panelRef consumer or Tab handling, run with DEV_PORT=7191, 2 workers: hel1759, hel1756, hel1750, hel1003, hel1090, hel1085, hel1572. 61/61 passed, EXIT 0 (e2e.txt).

Shared-hook audit (`usePortalPopover`). The `panelRef` consumers are ActionsMenu, Select, ProvenanceTrigger/ProvenancePopover, DashboardAppearanceEditor and OutputSchemaDisclosure. UserMenu and MobileNavSheet use local refs and are unaffected.
- Select keeps virtual focus on its trigger. The `panelRef.current.contains(event.target)` gate means Tab off the trigger never bounces back.
- ProvenancePopover wraps Tab inside its panel at both ends. Its focusout `relatedTarget` stays in the panel, so there is no close and no refocus, and the flag is cleared on that focusout.
- ActionsMenu items are `tabIndex={-1}`, so Tab always leaves the menu and now lands on the trigger. That matches the existing comment in ActionsMenu.tsx:85-87, which says Tab is for leaving the menu.
- OutputSchemaDisclosure: a Tab out of its panel now returns to the trigger, and the next Tab moves on. This is the intended D1 behaviour.
- The flag is cleared on every focusout exit path, on any non-Tab key, on pointerdown, and in the effect cleanup. The capture phase is documented. The deferred `queueMicrotask` focus is explained, and its probe is recorded (probe-sync.txt).

Code quality:
- The CSS keeps the same declarations under `[aria-disabled="true"]`. No new raw values; tokens unchanged.
- `savingRef` closes the same-tick double submit, and M4 proves it.
- The error is tied to Save through `aria-describedby` to an `aria-live="polite"` wrapper. InlineError's shared default is untouched.
- No dead code, no `any`, no TODO.

### Phase 3: UI Review — PASS
I checked by hand on this lane's running app (http://localhost:7191 / backend 10098, URL confirmed before each check), keyboard only after setup.
- Editor at 1440 and 1100, dark and light: Enter on the trigger puts focus on "Default". Shift+Tab closes the editor and focus lands on "Customize dashboard appearance".
- Failed save, light, with the PATCH held and then rejected in-page:
  - While saving: Save reads "Saving...", has `aria-disabled="true"`, is not `disabled`, and keeps focus. A second Enter does not resubmit.
  - After the failure: the editor is open, Twilight is still `aria-pressed`, and focus is on Save.
  - `aria-describedby` points at `dashboard-appearance-editor-error` (aria-live=polite), which holds "Failed to save dashboard appearance.".
- Actions menu at 1440: Enter puts focus on the first item. Tab closes the menu and focus lands on the trigger. The next Tab moves on to "Resize dashboard list", so focus is not trapped. A pointer click outside the menu hits the scrim (`tabindex=-1`), as it did before.
- Breakpoints: the editor trigger is in the DOM but hidden at 768 and 390 (0 visible), and visible at 1100 and 1440. No horizontal overflow at any of these widths. This supports the executor's phone claim, but the precise state is "rendered hidden", not "not rendered".
- Console errors during all flows: 0.
- Task 5.4 visual compare, which I performed. "Before" was emulated on the running app: the native `disabled` attribute plus main's `:disabled { opacity:.7; cursor:wait }` rule. "After" is the real aria-disabled state.
  - Computed opacity, cursor, background and color are identical.
  - The pixel diff differs only by Save's focus ring, which is intended: focus now stays on Save. Outside the button the maximum channel difference is 1, which is anti-aliasing noise.
  - Persisted evidence:
    - /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval/save-after-light.png
    - /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval/save-before-emulated-light.png
    - /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval/save-after-dark.png
    - /home/matt/Development/helio/.concertino/runs/HEL-1759/evidence/.concertino/scratch/HEL-1759/eval/save-before-emulated-dark.png
- Throwaway user 73279f2d-6e27-4fdd-a263-0ee80bd105d8 was deleted by exact id through userCleanup's deleteRecordedUsers ("deleted 1").

### Overall: FAIL

### Change Requests
1. `openspec/changes/popover-keyboard-focus-return/tasks.md` task 5.4 is ticked `[x]`, but no comparison was done or recorded. Make the tick true. Either:
   - change its Verify line to cite the evaluator-produced evidence above (the four persisted `ref=` paths, with the finding: identical computed opacity, cursor, background and color; the only diff is Save's intended focus ring), or
   - do the comparison yourself and save screenshots under .concertino/scratch/HEL-1759/.

   Do not leave a ticked task with no evidence behind it. No code change is needed.

### Non-blocking Suggestions
- `e2e/hel1759-popover-keyboard-focus.spec.ts:82` and `:138`: in the phone loop, the two editor tests keep behaviour titles ("a failed keyboard save keeps it open...") but only assert that the trigger is absent. Consider skipping the editor tests on phone with a stated reason, or giving the phone variant a title that says what it asserts.
- `e2e/hel1759-popover-keyboard-focus.spec.ts:34` and files-modified.md say the trigger is "not rendered" at phone width. It is rendered but hidden (count 1, visible 0), and it is also hidden at 768. Reword the comment.
- `usePortalPopover.ts` `tabbingRef`: if a Tab keydown is cancelled with no focus move, the flag stays set until the next key or pointer event. A later programmatic focus move out of the panel would then refocus the trigger. This is harmless today, but clearing the flag in a `queueMicrotask` after the keydown would make it exact.
