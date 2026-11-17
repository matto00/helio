## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: f70faaa62c5464b287d10894007d3128c8ef4d6e (base 2e98eba9287d61a47957129f1f097ea039125d92, resolved live). Cycle-2 delta reviewed: 304e7a7c3..f70faaa62.

### Phase 1: Spec Review — PASS

All three cycle-1 change requests are resolved.

**CR1 — spec, design and tasks now match what was built: resolved.**
- `spec.md` replaces the Output-menu scenario with the 390x300 step-sheet scenario: capped, scrolls inside, and the last item (reached with End) is inside the viewport and hit at its centre.
- It adds a "single-item phone menu cannot breach" scenario that carries the 776+8+54=838 ≤ 844 arithmetic.
- `design.md` D8's phone bullet now gives the reason and names MobileStepSheet as the case built. `tasks.md` 3.1 matches.
- The horizontal requirement is reworded to the behaviour that ships: aligned to the trigger's right edge, with at least 8px from the left edge. This was my cycle-1 non-blocking note.

**CR3 — SidebarItemList: the executor's claim checks out.**
- `SidebarItemList.tsx:440` renders `<ActionsMenu` only when `onDelete !== undefined`.
- Its only production consumer is `app/shell/AssistantContextList.tsx:66`. It passes no `onDelete`; line 82 says why: "No `onDelete`: HEL-663's API has no delete endpoint".
- Every other `<SidebarItemList` usage is in `SidebarItemList.test.tsx`.
- So no instance of this site shows a menu in the running app, and a live probe is impossible. The audit row in files-modified.md records this, plus the DashboardList stand-in.

The ticket's acceptance criteria and the other constraints are unchanged from cycle 1, where they passed.

### Phase 2: Code Review — PASS

I ran every gate myself in WORKTREE_PATH:
- `npm run lint`, `format:check`, `typecheck`, `check:e2e-types` and `npm --prefix frontend run build`: all exit 0.
- `npm test` (jest, 3 workers): 66 suites / 579 tests and 781 suites / 9553 tests, all pass.
- `e2e/hel1750-actions-menu-viewport-fit.spec.ts` with `--repeat-each=3` on 7182/10089: 6 of 6 pass.
- Vite is serving the cycle-2 `usePortalPopover.ts`, which imports the shared `VIEWPORT_MARGIN`.

**CR2 — desktop e2e now uses a fine pointer: resolved.**
- `test.use({ hasTouch: true })` now sits only inside a nested `phone` describe. The false comment is gone.
- The recorded red against the unfixed base `ActionsMenu.tsx` (`e2e-red-unfixed-cycle2.txt`) shows the mouse menu. The panel runs 394-559 (165px, 31px items, the menu the owner reported). The last item "Delete" ends at bottom 554, past 400, and is not the element hit at its centre.
- The phone red is unchanged: 342 > 300, not hit. Both cases are green after the fix.
- The executor recorded honestly that a first revert run looked green only because Vite had not yet reloaded the file.

**Non-blocking items from cycle 1, all taken:**
- One exported `VIEWPORT_MARGIN` (`panelFit.ts`), used by ActionsMenu and `usePortalPopover`.
- The unit test is renamed to "opens below at its natural height when it fits".
- The phone tap now asserts its effect (the menu closes, `getByRole("menu")` count is 0).

HEL-719 tests and `selectPanelFit.test.ts` are still unmodified. The only cycle-2 test-file change is the one rename.

### Phase 3: UI Review — PASS

- The cycle-2 production change only moves a constant: the value is 8 in every place, so runtime behaviour is identical.
- My cycle-1 live verification therefore still applies: light and dark, desktop and phone, opening below, flipped above, and capped with resize. Durable screenshots: `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval-*.png`.
- The fresh e2e run re-confirms both cases against the live servers.
- No new dev-DB residue from me this cycle. e2e users are removed by the harness teardown.

### Overall: PASS

### Non-blocking Suggestions
- `hooks/usePortalPopover.ts` now imports from `shared/ui/panelFit`, which makes a generic hook depend on a UI-layer module. It is harmless as is. If the layering matters to you, move `VIEWPORT_MARGIN` to a neutral constants module.
