## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: cdd4a8ec9bc39a25cf6c52fb4f8e670d7f920265 (base 108c04b7f71c110ba6a7f82d89f93c0c28de383c, resolved live).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (forward Tab off the last actions-menu item closes the menu and focuses the next control after the trigger; e2e red first): met. Red evidence in `.concertino/scratch/HEL-1776/red-e2e.log` shows the 6 new cases failing on unchanged code for the right reasons: desktop lands on the trigger, phone stays open because the Modal trap wraps, editor stays open. The 10 existing cases pass.
- AC2 (Shift+Tab keeps the HEL-1759 behaviour): met. The existing Shift+Tab e2e cases pass. The new unit test "leaves Shift+Tab to the HEL-1759 path" covers it, and I checked it live: Shift+Tab off the first item of "Eval B actions" closed the menu and focused the trigger.
- AC3 (review the other popovers): met. proposal.md / design D4 name ActionsMenu and DashboardAppearanceEditor as changing. Select (virtual focus), ProvenancePopover (wraps Tab itself) and the consumers without `panelRef` are listed as unchanged, each with a reason.
- AC4 (full hel1759 spec passes with the forward-Tab case): met (my own run is under Phase 2).
- Tasks: every item is checked and matches the diff. Two deviations, judged below:
  - Mutation 2.4(ii) (aim at the previous tabbable) was not run. Accepted as covered. The first `nextTabbableAfter.test.ts` case puts a `#before` button in front of the trigger and expects `#next`, so a previous-tabbable mutation fails it. The e2e also asserts identity with one specific DOM handle, so a wrong neighbour fails there too.
  - Mutation 2.4(v) (`setTimeout` defer) stays green in e2e. The executor recorded that the unit test "wins over a dialog-level Modal-style wrap listener" goes red. The design gate (skeptic-design-3) said ahead of time that a green e2e here is expected. The reason: `preventDefault` + `stopPropagation` on the panel already disarm the Modal trap, so a timer changes nothing observable in the browser. This is not a failed gate.
- Scope: the diff touches only `usePortalPopover.ts`, the new `nextTabbableAfter.ts`, their tests, `ProvenanceTrigger.test.tsx` (the guard tests D2 requires), the hel1759 e2e spec and the change's openspec artifacts. It changes nothing in the dashboard shell or list components, so it does not overlap sibling lane HEL-1773.
- Spec delta (`specs/portal-popover-hook/spec.md`) matches the shipped behaviour, including the dialog wrap and the trigger fallback.
- CONSTRAINTS in workflow-state.md: `[]`, nothing to honor.

### Phase 2: Code Review — PASS
I ran the gates myself in WORKTREE_PATH. Logs are in `.concertino/scratch/HEL-1776/eval-*.log`.
- `npm run lint`: exit 0 (zero warnings).
- `npm run format:check`: exit 0.
- `npm run typecheck`: exit 0.
- `npm test` (root + frontend, 3 workers): exit 0. Root 69 suites / 611 tests; frontend 829 suites / 10031 tests, all passing.
- `npm --prefix frontend run build`: exit 0.
- e2e, `--project=dev --workers=2`, lane DB `helio_hel1776`, DEV_PORT 7208: `hel1759-popover-keyboard-focus`, `hel1003-actions-menu-keyboard-reach` and `hel1756-popover-viewport-fit` together gave 38 passed, 6 skipped, 0 failed. The 6 skips are the phone appearance-editor cases, which the spec skips on purpose (`PHONE_EDITOR_REASON`: the trigger is hidden on phone).

The e2e oracle is independent of D3. `nativeNextAfter` focuses the trigger while the popover is closed, presses a real Tab and keeps the resulting `document.activeElement` as a handle. `expectMovedOn` then polls for identity with that handle. It also asserts the popover is gone, the trigger is not focused and focus is not `<body>`. The test never calls `nextTabbableAfter` or anything like it. On phone it also pins the label to "Close", the sheet header button.

Each new case starts from the last enabled item:
- Menus: `End`, then `expect(menu.locator('[role="menuitem"]:not([disabled])').last()).toBeFocused()`, then Tab.
- Editor: Tab until the focused label is `SAVE_LABEL`, assert it, then Tab.

Save is the editor's last tabbable; the forward-Tab case passing proves it, because the hook only steps in when nothing tabbable follows in the panel.

Other e2e specs that press Tab near the affected popovers:
- hel1003: Tab reaches the trigger; never Tab out of the menu.
- hel1756: Tab from a non-last control stays open.
- hel1085: the Size control is a Select (virtual focus).
- hel1090 / hel1080 / hel510 / hel1579 / hel1088: no portal-popover Tab-out.

None of them asserts the overruled forward-Tab-to-trigger behaviour.

Code:
- Hook (`usePortalPopover.ts`): the forward-Tab listener sits on the panel, which is deeper than the Modal's dialog-level trap. It is guarded by `defaultPrevented`, decides on `event.target`, closes and focuses synchronously, and has no timer. The focusout path refocuses the trigger only when the direction is `"backward"`. The doc comment is updated as D2 requires, including the coupling note. Every place that cleared the old boolean flag now clears to `null`.
- Helper (`nextTabbableAfter.ts`): scope is the trigger's enclosing `dialog[open]`, else `<body>`. It excludes the trigger, its contents and the panel, wraps to the dialog's first control, and falls back to the trigger, never `<body>`. It matches D3.
- Tests: these exercise real regressions:
  - Mutation (i) turns 2 unit tests and 6 e2e cases red.
  - Mutation (iii) turns the real-ProvenancePopover guard tests and the harness guard test red.
  - Mutation (iv) turns the unit dialog test and both phone e2e cases red.
- No `any`, no dead code, no TODO/FIXME. There is no XSS or input-boundary surface.

### Phase 3: UI Review — PASS
I started the servers with `start-servers.sh` (lane DB) and checked by hand in the browser on desktop:
- Focused "Eval B actions" and pressed Tab with the menu closed: native next = the "Eval A" row button.
- Opened the menu with Enter, pressed End (focus on "Delete", the last item), pressed Tab: the menu closed and focus landed on that same "Eval A" element (identity check true). Focus was not on `<body>`.
- Opened the menu again and pressed Shift+Tab: the menu closed and focus returned to "Eval B actions".
- Console: 0 errors, 0 warnings during these flows.
- Phone (step sheet `dialog[open]`) and the desktop appearance editor are covered by the passing e2e in light and dark themes.
- The change does not touch layout, so breakpoint rendering is unaffected. The phone viewport runs in e2e.
- I deleted my throwaway user by exact id with `buildUserDeleteSql` (a1b8613a-..., count now 0) and stopped the servers with `stop-servers.sh`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/hooks/usePortalPopover.ts` onPanelKeyDown, the `querySelectorAll("*").filter(tabIndex >= 0 && !disabled)` line: its "tabbable inside the panel" test differs from `nextTabbableAfter`'s `isTabbable`, which also checks visibility, `inert` and `hidden`. Suppose a visible control is followed only by a hidden `tabIndex>=0` control in the panel. The hook would not step in, the browser would move focus outside the panel, and the focusout path would only close the popover. No current consumer can reach this. Exporting `isTabbable` and reusing it would remove the second definition.
- `usePortalPopover.ts` uses `panel!` three times because `onPanelKeyDown` is a hoisted function declaration, so the narrowing is lost. An arrow function `const onPanelKeyDown = (event: KeyboardEvent) => {...}` keeps it, with no non-null assertions.
- `usePortalPopover.test.tsx`, in "stands down for a Tab a same-panel listener already handled": the comment "`open` rendered before the listener existed for the click-open; re-open path: the panel is mounted now." is confusing. The listener is attached by the panel's ref callback at mount. Reword it or remove it.
- `usePortalPopover.ts` is now 304 lines, over CONTRIBUTING's ~250 soft budget (informational, under 400). The new keydown effect is a natural candidate for a small `usePanelForwardTab` hook if the file grows again.
- Task 1.3 asked for the desktop "next control" to be named from the live DOM in the red evidence; notes.md does not name it. For the record: on the dashboard list it is the next row's dashboard button (e.g. "Eval A"); when the row is the last one, it is the "Resize dashboard list" separator.
