## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: cdd4a8ec9bc39a25cf6c52fb4f8e670d7f920265. Base resolved live with `resolve-review-base.sh`: 108c04b7f71c110ba6a7f82d89f93c0c28de383c.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/actions-menu-forward-tab/HEL-1776`.
- **Diff scope:** `git diff 108c04b7f...HEAD` touches `usePortalPopover.ts`, the new `nextTabbableAfter.ts`, their tests, `ProvenanceTrigger.test.tsx`, `e2e/hel1759-popover-keyboard-focus.spec.ts` and the change's openspec artifacts. Nothing in the dashboard shell or list, so it does not overlap HEL-1773.
- **Driver claim about HEL-1736 and HEL-1762 (verified, true):** both commits (56b4ae1ff, 4b6212450) are already ancestors of HEAD. `grep -n "Tab\|keydown"` finds no match in `modalDialogRegistry.ts` or `panelFit.ts`. The diff only re-imports the unchanged `VIEWPORT_MARGIN`. The e2e run below ran with both present.
- **AC1 (forward Tab off the actions menu moves on; e2e red first): met.**
  - Red evidence: `scratch/HEL-1776/red-e2e.log` shows the 6 new cases failing on unchanged code (the menu stays open in the phone sheet, and the trigger gets focus on desktop) while the 10 existing cases pass.
  - The oracle in `nativeNextAfter` is the browser's own Tab from the closed trigger, held as a DOM handle. It is independent of `nextTabbableAfter`.
  - My run of the full `hel1759-popover-keyboard-focus.spec.ts` plus `hel1003-actions-menu-keyboard-reach.spec.ts` (lane DB `helio_hel1776`, DEV_PORT 7208, `--workers=2`) gave `20 passed, 6 skipped`, exit 0. The 6 skips are the phone appearance-editor cases (`PHONE_EDITOR_REASON`). Log: `.concertino/scratch/HEL-1776/skeptic-e2e.log`.
- **AC2 (Shift+Tab unchanged): met.**
  - The focusout path now refocuses only when `viaTab === "backward"`.
  - The panel listener returns early on `event.shiftKey`.
  - The existing Shift+Tab e2e cases passed in my run, as did the unit test "leaves Shift+Tab to the HEL-1759 path".
- **AC4 (full hel1759 spec passes): met** (same run as AC1).
- **Jest:** `npm --prefix frontend test -- --maxWorkers=3 --testPathPatterns='usePortalPopover|nextTabbableAfter|ProvenanceTrigger|ActionsMenu|Select|OutputSchemaDisclosure|DashboardAppearanceEditor'` gave `Test Suites: 20 passed, 20 total; Tests: 196 passed, 196 total`.
- **AC3 (which other popovers change): NOT met. The consumer review states something false.**
  - `proposal.md` says: "UserMenu / IconButton / OutputSchemaDisclosure: no change - do not attach the hook's `panelRef`, so they have no Tab-out handling at all." `skeptic-design-1.md:62` repeats it, and `evaluation-1.md` accepted it.
  - Ground truth: `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.tsx:47` destructures `panelRef` and `:70` does `panelRef.current = el` on its portalled `role="dialog"` panel. That is true both at base (`git show 108c04b7f:...` shows the same lines 47/70) and at HEAD.
  - The panel contains tabbable controls from `SchemaFieldViewer`: a filter `<input>` and a "Show all N" button. So the new panel keydown listener is attached to it.
  - Probe: a throwaway jsdom test outside the worktree, run with the worktree's jest config against HEAD code. It rendered `<button>before</button><OutputSchemaDisclosure fields={40 fields}/><button>after</button>`, clicked the trigger, focused the panel's last tabbable and fired a forward Tab keydown. Output:
    ```
    panel focusables: ['<input ... class="schema-field-viewer__filter" ...', '<button type="button" class="schema-field-viewer__show-all">Show all 40</button>']
    notPrevented= false panelOpen= false active= <button type="button">after</button>
    ```
  - So OutputSchemaDisclosure DOES change. Under HEL-1759 a forward Tab off its last control returned focus to the "N fields" trigger. Now it closes the panel and moves on to the next control after the trigger. Users reach this path by clicking into the filter and then tabbing.
  - The new behaviour is consistent with the hook-wide rule (design D4), so the code itself is defensible. But the AC asks the delivery to "say which ones change". The delivered answer omits a consumer that changes and gives a false reason for doing so. The PR body would carry that false statement, and no test pins the new behaviour for this consumer.
- **Select / ProvenancePopover "unchanged" claims (verified, true):**
  - Select options are `tabIndex={-1}` with virtual focus on the trigger, so the `panel.contains(from)` check fails and the listener returns.
  - For ProvenancePopover, the real-host guard tests in `ProvenanceTrigger.test.tsx` pass.
  - UserMenu uses its own local `panelRef` and does not attach the hook's (`UserMenu.tsx:79-80`), so the claim holds there.
- **Code review:** The `isOpen`-keyed effect reads `panelRef.current` correctly, because `handleOpen` sets `panelPos` in the same batch, so every consumer's panel is mounted at the first commit. The `defaultPrevented` guard and the decision on `event.target` match design D2. `nextTabbableAfter` never returns `<body>`.
- **UI/design judgment:** no visual surface changed (no CSS, no markup, no tokens). The change is keyboard focus only, verified behaviourally above. There were no screenshots to judge.

### Verdict: REFUTE

### Change Requests

1. **Correct the AC3 consumer review in `proposal.md` (the "UserMenu / IconButton / OutputSchemaDisclosure" bullet) and design.md (Context consumer list and D4).** OutputSchemaDisclosure attaches the hook's `panelRef` (`OutputSchemaDisclosure.tsx:70`). Its panel has tabbable controls (the filter input and "Show all N"), so it **changes**: forward Tab off its last control now closes the panel and moves on to the control after the "N fields" trigger, where HEL-1759 returned to the trigger. List it as changing, with the reason, and remove it from the "does not attach `panelRef`" bullet. Re-check that every remaining "unchanged" consumer is backed by a line citation, not an assertion. The PR body must state the corrected list.
2. **Pin the OutputSchemaDisclosure behaviour with a test.** Add a case to `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.test.tsx`: open the panel with a large field list, focus the last tabbable ("Show all N"), fire a forward Tab, then assert the panel is closed and focus is on the control after the trigger, not on the trigger. Add a Shift+Tab-off-first-control counterpart that asserts focus returns to the trigger. Show it red with the panel listener removed, or with the focusout `"backward"` restriction reverted.

### Non-blocking notes

- Mutation 2.4(ii) was not run separately. I accept the evaluator's reasoning: the first `nextTabbableAfter.test.ts` case places `#before` ahead of the trigger and expects `#next`.
- Mutation 2.4(v) stays green in e2e, as skeptic-design-3 predicted.
- **Gate observation (not an mtime issue):** the design-gate round 1 and the evaluator both accepted the OutputSchemaDisclosure "no `panelRef`" claim without a grep. One grep (`panelRef.current = el` across consumers) refutes it.
